/**
 * AllItemsService — weekly cross-board activity report.
 *
 * NOTE: Bespoke MyPass-only report (feature 0012, proposals 0062/0063).
 * This module is fully isolated. Do not modify existing services to support it.
 * It may be deleted without affecting any other module.
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  BoardConfig,
  JiraIssue,
  JiraChangelog,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { buildDirectLinkIdeaMap } from '../metrics/roadmap-link-utils.js';
import { isDeliveredOnRoadmap } from '../metrics/roadmap-classification.js';
import { isoWeekKeyToDates } from '../lib/iso-week.js';
import { SprintMembershipService } from '../sprint-membership/sprint-membership.service.js';
import {
  resolveEpicIdeas,
  type EpicConflictResolution,
} from '../roadmap/resolve-epic-ideas.js';
import {
  buildKanbanBoardEntryDateMap,
  filterKanbanIssues,
  getKanbanPulledIn,
  getKanbanCompletedThisWeek,
  getKanbanInFlight,
  DEFAULT_BOARD_ENTRY_STATUSES,
} from '../lib/kanban-week-stats.js';
import type {
  AllItemsIssue,
  AllItemsBoardResult,
  AllItemsResponse,
  AllItemsTotals,
  AllItemsBoardSummary,
  BoardHealthScore,
} from './dto/all-items-response.dto.js';

type ActiveFilter = 'added-mid-sprint' | 'not-on-roadmap' | 'support' | 'ttb-support';

@Injectable()
export class AllItemsService {
  private readonly logger = new Logger(AllItemsService.name);
  private readonly jiraBaseUrl: string;

  constructor(
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
    @InjectRepository(JpdIdea)
    private readonly jpdIdeaRepo: Repository<JpdIdea>,
    @InjectRepository(RoadmapConfig)
    private readonly roadmapConfigRepo: Repository<RoadmapConfig>,
    private readonly sprintMembership: SprintMembershipService,
    private readonly configService: ConfigService,
  ) {
    const baseUrl = this.configService.get<string>('JIRA_BASE_URL', '');
    if (!baseUrl) {
      this.logger.warn(
        'JIRA_BASE_URL is not configured — jiraUrl fields will be empty strings',
      );
    }
    this.jiraBaseUrl = baseUrl;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async getAllItems(
    week: string,
    filterParam: string | undefined,
  ): Promise<AllItemsResponse> {
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    let weekStart: Date;
    let weekEnd: Date;
    try {
      ({ weekStart, weekEnd } = isoWeekKeyToDates(week, tz));
    } catch {
      throw new BadRequestException(`Invalid week format: "${week}". Expected YYYY-Www e.g. 2026-W20`);
    }
    const filters = this.parseFilters(filterParam);

    const configs = await this.boardConfigRepo.find();

    if (configs.length === 0) {
      return {
        week,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        boards: [],
        totals: { totalItems: 0, startedCount: 0, addedMidSprintCount: 0, completedCount: 0, onRoadmapCount: 0, supportCount: 0, ttbSupportCount: 0, inFlightCount: 0 },
        overallScore: 100,
      };
    }

    // Load roadmap ideas once for all boards — avoids N×2 queries when
    // processing multiple boards in parallel.
    const { allIdeas, ruleByJpdKey } = await this.loadAllIdeas();

    const boardResults: AllItemsBoardResult[] = await Promise.all(
      configs.map((config) =>
        this.processBoardForWeek(config, week, weekStart, weekEnd, filters, allIdeas, ruleByJpdKey),
      ),
    );

    // Sort boards alphabetically by boardId for consistent display order
    boardResults.sort((a, b) => a.boardId.localeCompare(b.boardId));

    const totals = this.aggregateTotals(boardResults);
    const overallScore = this.calculateOverallScore(boardResults);

    return {
      week,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      boards: boardResults,
      totals,
      overallScore,
    };
  }

  // ---------------------------------------------------------------------------
  // Per-board processing
  // ---------------------------------------------------------------------------

  private async processBoardForWeek(
    config: BoardConfig,
    _week: string,
    weekStart: Date,
    weekEnd: Date,
    filters: Set<ActiveFilter>,
    allIdeas: JpdIdea[],
    ruleByJpdKey: Map<string, EpicConflictResolution>,
  ): Promise<AllItemsBoardResult> {
    const boardId = config.boardId;
    const isKanban = config.boardType === 'kanban';
    const doneStatuses = new Set(
      (config.doneStatusNames ?? ['Done', 'Closed', 'Released']).map((s) => s.toLowerCase()),
    );
    const cancelledStatuses = new Set(
      (config.cancelledStatusNames ?? ['Cancelled', "Won't Do"]).map((s) => s.toLowerCase()),
    );
    const inProgressStatuses = new Set(config.inProgressStatusNames ?? ['In Progress']);
    const boardEntryStatuses = new Set(
      (config.boardEntryStatuses ?? [...DEFAULT_BOARD_ENTRY_STATUSES]).map((s) => s.toLowerCase()),
    );
    const backlogStatusIds: string[] = config.backlogStatusIds ?? [];
    const dataStartBound: Date | null = config.dataStartDate
      ? new Date(config.dataStartDate)
      : null;

    // -----------------------------------------------------------------------
    // Step 1 — Determine the working set for this board + week
    //
    // Scrum: union of committedKeys ∪ addedKeys from sprints overlapping the
    //        week window. An issue that is merely on the board but not in any
    //        active/recent sprint is NOT included.
    //
    // Kanban: issues whose board-entry date falls within the week. Issues
    //         boarded in a prior week are NOT included.
    // -----------------------------------------------------------------------

    // Load all board work items (needed by SprintMembershipService and for
    // kanban board-entry detection).
    const allBoardIssues = (await this.issueRepo.find({ where: { boardId } })).filter(
      (i) => isWorkItem(i.issueType),
    );

    if (allBoardIssues.length === 0) {
      return this.emptyBoardResult(boardId, isKanban ? 'kanban' : 'scrum');
    }

    const allBoardKeys = allBoardIssues.map((i) => i.key);
    const issueByKey = new Map(allBoardIssues.map((i) => [i.key, i]));

    // Load changelogs for all board issues — needed for kanban board-entry
    // detection and for scrum status classification.
    const allChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allBoardKeys })
      .andWhere('cl.field IN (:...fields)', { fields: ['status', 'Sprint'] })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    const statusChangelogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of allChangelogs) {
      if (cl.field !== 'status') continue;
      const list = statusChangelogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      statusChangelogsByIssue.set(cl.issueKey, list);
    }

    // --- Build the week-scoped working set ---
    let workingSet: JiraIssue[];
    let addedMidSprintKeys = new Set<string>();
    let sprintNameByIssue = new Map<string, string>();
    // Kanban-only: board-entry date map used by working set filter and completion scan
    let kanbanBoardEntryDateByKey = new Map<string, Date>();
    // Scrum-only: sprint-lifetime committed/added totals for stability calculation
    let scrumTotalCommitted = 0;
    let scrumTotalAdded = 0;

    if (isKanban) {
      // Compute board-entry date for every board issue using the shared helper
      kanbanBoardEntryDateByKey = buildKanbanBoardEntryDateMap(
        allBoardIssues,
        statusChangelogsByIssue,
        boardEntryStatuses,
      );

      // Apply dataStartDate filter + inBacklog exclusion (ADR 0067) using the
      // shared helper. Cancelled issues pre-filtered before passing.
      const filteredBoardIssues = filterKanbanIssues({
        issues: allBoardIssues.filter((i) => !cancelledStatuses.has(i.status.toLowerCase())),
        dataStartBound,
        boardEntryDateByKey: kanbanBoardEntryDateByKey,
      });

      workingSet = getKanbanPulledIn(
        filteredBoardIssues,
        kanbanBoardEntryDateByKey,
        weekStart,
        weekEnd,
        cancelledStatuses,
      );
    } else {
      // Scrum: find sprints that overlap the week window, reconstruct
      // membership, and take the union of committedKeys ∪ addedKeys.
      const overlappingSprints = await this.findSprintsOverlappingWeek(
        boardId,
        weekStart,
        weekEnd,
      );

      if (overlappingSprints.length === 0) {
        return this.emptyBoardResult(boardId, 'scrum');
      }

      const membershipMap = await this.sprintMembership.reconstructMany({
        sprints: overlappingSprints,
        boardId,
        boardIssues: allBoardIssues,
      });

      const workingSetKeys = new Set<string>();
      for (const sprint of overlappingSprints) {
        const m = membershipMap.get(sprint.id);
        if (!m) continue;
        scrumTotalCommitted += m.committedKeys.size;
        scrumTotalAdded += m.addedKeys.size;
        for (const key of m.committedKeys) {
          workingSetKeys.add(key);
          if (!sprintNameByIssue.has(key)) sprintNameByIssue.set(key, sprint.name);
        }
        for (const key of m.addedKeys) {
          workingSetKeys.add(key);
          sprintNameByIssue.set(key, sprint.name);

          // Only mark addedMidSprint if the Sprint-field changelog that added
          // this issue to the sprint falls within the selected week window.
          // This prevents an issue added in W19 from appearing as "added" in W20.
          const sprintLogs = m.logsByIssue.get(key) ?? [];
          const addedAt = sprintLogs.find(
            (cl) =>
              cl.toId != null
                ? cl.toId.split(',').map((s) => s.trim()).includes(sprint.id)
                : cl.toValue?.split(',').map((s) => s.trim()).includes(sprint.name) ?? false,
          )?.changedAt;

          if (addedAt !== undefined && addedAt >= weekStart && addedAt <= weekEnd) {
            addedMidSprintKeys.add(key);
          }
        }
      }

      workingSet = [...workingSetKeys]
        .map((k) => issueByKey.get(k))
        .filter((i): i is JiraIssue => i !== undefined);
    }

    if (workingSet.length === 0 && !isKanban) {
      return this.emptyBoardResult(boardId, 'scrum');
    }

    const workingSetKeys = workingSet.map((i) => i.key);

    // -----------------------------------------------------------------------
    // Step 2 — Load support links for the working set only
    // -----------------------------------------------------------------------
    const supportLabels: string[] = config.supportLabels ?? [];
    const supportLinkTypes: string[] = config.supportLinkTypes ?? [];
    const supportEpics: string[] = (config.supportEpics ?? []).map((e) => e.toUpperCase());
    const triageBoardKey: string | null = config.triageBoardKey ?? null;
    const triagePrefix = triageBoardKey ? `${triageBoardKey}-` : null;

    const linksByIssue = new Map<string, JiraIssueLink[]>();
    if (supportLinkTypes.length > 0 && triageBoardKey && workingSetKeys.length > 0) {
      const links = await this.issueLinkRepo
        .createQueryBuilder('lnk')
        .where('lnk.sourceIssueKey IN (:...keys)', { keys: workingSetKeys })
        .andWhere('LOWER(lnk.linkTypeName) IN (:...types)', {
          types: supportLinkTypes.map((t) => t.toLowerCase()),
        })
        .getMany();
      for (const lnk of links) {
        const list = linksByIssue.get(lnk.sourceIssueKey) ?? [];
        list.push(lnk);
        linksByIssue.set(lnk.sourceIssueKey, list);
      }
    }

    // -----------------------------------------------------------------------
    // Step 3 — Roadmap coverage for the working set
    // -----------------------------------------------------------------------
    const epicIdeaMap = this.filterIdeasForWindow(allIdeas, weekStart, weekEnd, ruleByJpdKey);

    const roadmapLinkTypes: string[] = config.roadmapLinkTypes ?? [];
    const directLinkIdeaMap = await buildDirectLinkIdeaMap(
      this.issueLinkRepo,
      workingSetKeys,
      allIdeas,
      roadmapLinkTypes,
      ruleByJpdKey,
    );

    // -----------------------------------------------------------------------
    // Step 4 — Classify each issue in the working set
    // -----------------------------------------------------------------------
    const items: AllItemsIssue[] = [];

    for (const issue of workingSet) {
      const statusLogs = statusChangelogsByIssue.get(issue.key) ?? [];

      // started: first in-progress (scrum) or board-entry (kanban) within week
      const started = this.detectStarted(
        statusLogs,
        inProgressStatuses,
        boardEntryStatuses,
        isKanban,
        weekStart,
        weekEnd,
      );

      // completed: transitioned to a done status within the week
      const completedAt = this.detectCompletionDate(statusLogs, doneStatuses, weekStart, weekEnd);
      const completed = completedAt !== null;

      // addedMidSprint (scrum) / kanbanAdd (kanban)
      const addedMidSprint = !isKanban && addedMidSprintKeys.has(issue.key);
      // kanbanAdd is always false for kanban — mid-week concept removed (proposal 0066).
      // Kanban boards don't have a meaningful committed-vs-added split.
      const kanbanAdd = false;

      // onRoadmap: completed within roadmap idea target date
      const onRoadmap = this.classifyRoadmap(issue, completedAt, epicIdeaMap, directLinkIdeaMap);

      // support flags
      const epicMatch =
        supportEpics.length > 0 &&
        issue.epicKey != null &&
        supportEpics.includes(issue.epicKey.toUpperCase());

      const labelMatch =
        supportLabels.length > 0 &&
        Array.isArray(issue.labels) &&
        (issue.labels as string[]).some((l) => supportLabels.includes(l));

      const issueLinks = linksByIssue.get(issue.key) ?? [];
      const ttbLinkMatch =
        supportLinkTypes.length > 0 &&
        triagePrefix !== null &&
        issueLinks.some(
          (lnk) =>
            supportLinkTypes.includes(lnk.linkTypeName) &&
            lnk.targetIssueKey.startsWith(triagePrefix),
        );

      const isSupport = epicMatch || labelMatch || ttbLinkMatch;
      const isTtbSupport = ttbLinkMatch;

      items.push({
        key: issue.key,
        summary: issue.summary,
        issueType: issue.issueType,
        status: issue.status,
        boardId,
        assignee: issue.assignee ?? null,
        points: issue.points ?? null,
        labels: Array.isArray(issue.labels) ? (issue.labels as string[]) : [],
        jiraUrl: this.jiraBaseUrl ? `${this.jiraBaseUrl}/browse/${issue.key}` : '',
        epicKey: issue.epicKey ?? null,
        sprintName: sprintNameByIssue.get(issue.key) ?? null,
        started,
        addedMidSprint,
        kanbanAdd,
        completed,
        onRoadmap,
        isSupport,
        isTtbSupport,
        inFlight: false, // set correctly for kanban after the completion scan
      });
    }

    // Build summary from the working-set items ONLY — before the kanban
    // completion scan expands the items array with prior-week completers.
    // This ensures summary.totalItems = workingSet.length (proposal 0066).
    const summary = this.buildSummary(items);

    if (isKanban) {
      // addedMidSprintCount has no meaning for kanban — zero it out (proposal 0066).
      summary.addedMidSprintCount = 0;

      // Board-wide completion scan using the shared helper.
      // Candidate pool: all filtered board issues (inBacklog + dataStartDate
      // + cancelled gates — ADR 0067).
      const filteredBoardIssues = filterKanbanIssues({
        issues: allBoardIssues.filter((i) => !cancelledStatuses.has(i.status.toLowerCase())),
        dataStartBound,
        boardEntryDateByKey: kanbanBoardEntryDateByKey,
      });

      // doneStatuses is already lowercased (Set built at top of method)
      const completedIssues = getKanbanCompletedThisWeek(
        filteredBoardIssues,
        statusChangelogsByIssue,
        doneStatuses,
        weekStart,
        weekEnd,
      );

      summary.completedCount = completedIssues.length;
      summary.onRoadmapCount = completedIssues.filter((issue) => {
        const statusLogs = statusChangelogsByIssue.get(issue.key) ?? [];
        const completedAt = this.detectCompletionDate(statusLogs, doneStatuses, weekStart, weekEnd);
        return this.classifyRoadmap(issue, completedAt, epicIdeaMap, directLinkIdeaMap);
      }).length;

      // Add prior-week completers to the item list so the user can see which
      // tickets contributed to completedCount (they do not affect summary counts).
      const workingSetKeySet = new Set(workingSet.map((i) => i.key));

      // Collect keys of issues that will be added (completers + in-flight) so we
      // can fetch their support links in a single query (Option 2 — second query).
      const extraKeys: string[] = [];
      for (const issue of completedIssues) {
        if (!workingSetKeySet.has(issue.key)) extraKeys.push(issue.key);
      }
      const inFlightIssues = getKanbanInFlight(
        filteredBoardIssues,
        doneStatuses,
        cancelledStatuses,
        kanbanBoardEntryDateByKey,
        weekStart,
      );
      for (const issue of inFlightIssues) {
        if (!workingSetKeySet.has(issue.key) && !extraKeys.includes(issue.key)) {
          extraKeys.push(issue.key);
        }
      }

      // Fetch support links for extra keys (second query — only the new keys)
      if (supportLinkTypes.length > 0 && triageBoardKey && extraKeys.length > 0) {
        const extraLinks = await this.issueLinkRepo
          .createQueryBuilder('lnk')
          .where('lnk.sourceIssueKey IN (:...keys)', { keys: extraKeys })
          .andWhere('LOWER(lnk.linkTypeName) IN (:...types)', {
            types: supportLinkTypes.map((t) => t.toLowerCase()),
          })
          .getMany();
        for (const lnk of extraLinks) {
          const list = linksByIssue.get(lnk.sourceIssueKey) ?? [];
          list.push(lnk);
          linksByIssue.set(lnk.sourceIssueKey, list);
        }
      }

      for (const issue of completedIssues) {
        if (workingSetKeySet.has(issue.key)) continue; // already in list

        const statusLogs = statusChangelogsByIssue.get(issue.key) ?? [];
        const completedAt = this.detectCompletionDate(statusLogs, doneStatuses, weekStart, weekEnd);

        const onRoadmap = this.classifyRoadmap(issue, completedAt, epicIdeaMap, directLinkIdeaMap);
        const isSupport =
          (config.supportEpics ?? []).some((e) => issue.epicKey?.toUpperCase() === e.toUpperCase()) ||
          (config.supportLabels ?? []).some(
            (l) => (Array.isArray(issue.labels) ? (issue.labels as string[]) : []).includes(l),
          );
        const isTtbSupport = isSupport || this.classifyTtbSupport(issue.key, linksByIssue, triagePrefix);

        items.push(this.buildKanbanItem(issue, boardId, {
          completed: true,
          onRoadmap,
          isSupport: isSupport || isTtbSupport,
          isTtbSupport,
          inFlight: false,
        }));
      }

      // In-flight: on-board issues that entered BEFORE this week, not done, not cancelled.
      // Issues that entered this week are "Pulled In" — excluded from In Flight.
      summary.inFlightCount = inFlightIssues.length;

      // Add in-flight issues to the item list if not already present
      // (an issue can be in-flight AND have entered this week — avoid duplicates).
      const existingKeys = new Set(items.map((i) => i.key));
      const itemsByKey = new Map(items.map((i) => [i.key, i]));
      for (const issue of inFlightIssues) {
        if (existingKeys.has(issue.key)) {
          // Already in list as a working-set item — mark it inFlight=true
          const existing = itemsByKey.get(issue.key);
          if (existing) existing.inFlight = true;
          continue;
        }
        const isSupport =
          (config.supportEpics ?? []).some((e) => issue.epicKey?.toUpperCase() === e.toUpperCase()) ||
          (config.supportLabels ?? []).some(
            (l) => (Array.isArray(issue.labels) ? (issue.labels as string[]) : []).includes(l),
          );
        const isTtbSupport = isSupport || this.classifyTtbSupport(issue.key, linksByIssue, triagePrefix);
        items.push(this.buildKanbanItem(issue, boardId, {
          completed: false,
          onRoadmap: false,
          isSupport: isSupport || isTtbSupport,
          isTtbSupport,
          inFlight: true,
        }));
      }
    }

    // Apply filters after the kanban item list has been expanded with
    // prior-week completers.
    const filteredItems = this.applyFilters(items, filters);

    const healthScore = this.calculateHealthScore(
      summary,
      isKanban ? 'kanban' : 'scrum',
      isKanban ? undefined : scrumTotalCommitted,
      isKanban ? undefined : scrumTotalAdded,
    );

    return {
      boardId,
      boardType: isKanban ? 'kanban' : 'scrum',
      items: filteredItems,
      summary,
      healthScore,
    };
  }

  // ---------------------------------------------------------------------------
  // Sprint overlap query
  //
  // Returns sprints for a board whose window overlaps [weekStart, weekEnd]:
  //   sprint.startDate <= weekEnd
  //   AND (sprint.endDate >= weekStart OR sprint.state = 'active')
  // ---------------------------------------------------------------------------

  private async findSprintsOverlappingWeek(
    boardId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<JiraSprint[]> {
    return this.sprintRepo
      .createQueryBuilder('s')
      .where('s.boardId = :boardId', { boardId })
      .andWhere("s.state IN ('active', 'closed')")
      .andWhere('s.startDate <= :weekEnd', { weekEnd })
      .andWhere(
        "(s.endDate >= :weekStart OR s.state = 'active')",
        { weekStart },
      )
      .getMany();
  }

  // ---------------------------------------------------------------------------
  // Classification helpers
  // ---------------------------------------------------------------------------

  private detectStarted(
    statusLogs: JiraChangelog[],
    inProgressStatuses: Set<string>,
    boardEntryStatuses: Set<string>,
    isKanban: boolean,
    weekStart: Date,
    weekEnd: Date,
  ): boolean {
    if (isKanban) {
      // Kanban working set is already filtered to issues with board-entry in
      // the week, so the board-entry transition itself IS the "started" event.
      const entryDate = this.detectBoardEntryDate(statusLogs, boardEntryStatuses);
      return entryDate !== null && entryDate >= weekStart && entryDate <= weekEnd;
    }

    // Scrum: first ever in-progress transition is within the week
    const firstInProgress = statusLogs.find(
      (cl) => cl.toValue !== null && inProgressStatuses.has(cl.toValue),
    );
    if (!firstInProgress) return false;
    return firstInProgress.changedAt >= weekStart && firstInProgress.changedAt <= weekEnd;
  }

  private detectCompletionDate(
    statusLogs: JiraChangelog[],
    doneStatuses: Set<string>, // must be pre-lowercased
    weekStart: Date,
    weekEnd: Date,
  ): Date | null {
    const lastDoneInWindow = [...statusLogs]
      .reverse()
      .find(
        (cl) =>
          cl.toValue !== null &&
          doneStatuses.has(cl.toValue.toLowerCase()) &&
          cl.changedAt >= weekStart &&
          cl.changedAt <= weekEnd,
      );
    return lastDoneInWindow?.changedAt ?? null;
  }

  private detectBoardEntryDate(
    statusLogs: JiraChangelog[],
    boardEntryStatuses: Set<string>,
  ): Date | null {
    const entry = statusLogs.find(
      (cl) =>
        cl.toValue !== null &&
        boardEntryStatuses.has(cl.toValue.toLowerCase()),
    );
    return entry?.changedAt ?? null;
  }

  private classifyRoadmap(
    issue: JiraIssue,
    completedAt: Date | null,
    epicIdeaMap: Map<string, { targetDate: Date }>,
    directLinkIdeaMap: Map<string, { targetDate: Date }>,
  ): boolean {
    const epicIdea = issue.epicKey ? epicIdeaMap.get(issue.epicKey) : undefined;
    const directIdea = directLinkIdeaMap.get(issue.key);
    return isDeliveredOnRoadmap(epicIdea, directIdea, completedAt);
  }

  // ---------------------------------------------------------------------------
  // Idea filtering (equivalent to RoadmapService.filterIdeasForWindow)
  // ---------------------------------------------------------------------------

  private filterIdeasForWindow(
    ideas: JpdIdea[],
    windowStart: Date,
    windowEnd: Date,
    ruleByJpdKey: Map<string, EpicConflictResolution>,
  ): Map<string, { targetDate: Date }> {
    const inWindow = ideas.filter((idea) => {
      if (!idea.startDate || !idea.targetDate) return false;
      const targetEod = new Date(idea.targetDate.getTime());
      targetEod.setUTCHours(23, 59, 59, 999);
      return targetEod >= windowStart && idea.startDate <= windowEnd;
    });

    const resolved = resolveEpicIdeas(
      inWindow,
      (idea) => ruleByJpdKey.get((idea as JpdIdea).jpdKey) ?? 'earliest',
    );

    const result = new Map<string, { targetDate: Date }>();
    for (const [epicKey, entry] of resolved) {
      if (entry.primaryIdea.targetDate) {
        result.set(epicKey, { targetDate: entry.primaryIdea.targetDate });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  private applyFilters(
    items: AllItemsIssue[],
    filters: Set<ActiveFilter>,
  ): AllItemsIssue[] {
    if (filters.size === 0) return items;

    return items.filter((item) => {
      if (filters.has('added-mid-sprint') && !(item.addedMidSprint || item.kanbanAdd)) return false;
      if (filters.has('not-on-roadmap') && item.onRoadmap) return false;
      if (filters.has('support') && !item.isSupport) return false;
      if (filters.has('ttb-support') && !item.isTtbSupport) return false;
      return true;
    });
  }

  private parseFilters(filterParam: string | undefined): Set<ActiveFilter> {
    if (!filterParam) return new Set();
    const valid: ActiveFilter[] = ['added-mid-sprint', 'not-on-roadmap', 'support', 'ttb-support'];
    const parsed = filterParam
      .split('|')
      .map((f) => f.trim())
      .filter((f): f is ActiveFilter => valid.includes(f as ActiveFilter));
    return new Set(parsed);
  }

  // ---------------------------------------------------------------------------
  // Summary and health score
  // ---------------------------------------------------------------------------

  private buildKanbanItem(
    issue: JiraIssue,
    boardId: string,
    overrides: Pick<AllItemsIssue, 'completed' | 'onRoadmap' | 'isSupport' | 'isTtbSupport' | 'inFlight'>,
  ): AllItemsIssue {
    return {
      key: issue.key,
      summary: issue.summary,
      issueType: issue.issueType,
      status: issue.status,
      boardId,
      assignee: issue.assignee ?? null,
      points: issue.points ?? null,
      labels: Array.isArray(issue.labels) ? (issue.labels as string[]) : [],
      jiraUrl: this.jiraBaseUrl ? `${this.jiraBaseUrl}/browse/${issue.key}` : '',
      epicKey: issue.epicKey ?? null,
      sprintName: null,
      started: false,
      addedMidSprint: false,
      kanbanAdd: false,
      ...overrides,
    };
  }

  /**
   * Classify whether an issue is TTB support based on its issue links.
   * Returns true if the issue has a link (matching supportLinkTypes) pointing
   * to a ticket on the triage board (triagePrefix).
   */
  private classifyTtbSupport(
    issueKey: string,
    linksByIssue: Map<string, JiraIssueLink[]>,
    triagePrefix: string | null,
  ): boolean {
    if (!triagePrefix) return false;
    const issueLinks = linksByIssue.get(issueKey) ?? [];
    return issueLinks.some(
      (lnk) => lnk.targetIssueKey.startsWith(triagePrefix),
    );
  }

  private buildSummary(items: AllItemsIssue[]): AllItemsBoardSummary {
    return {
      totalItems: items.length,
      startedCount: items.filter((i) => i.started).length,
      addedMidSprintCount: items.filter((i) => i.addedMidSprint || i.kanbanAdd).length,
      completedCount: items.filter((i) => i.completed).length,
      onRoadmapCount: items.filter((i) => i.onRoadmap).length,
      supportCount: items.filter((i) => i.isSupport).length,
      ttbSupportCount: items.filter((i) => i.isTtbSupport).length,
      inFlightCount: 0, // overridden for kanban boards after in-flight scan
    };
  }

  private calculateHealthScore(
    summary: AllItemsBoardSummary,
    boardType: 'scrum' | 'kanban',
    scrumCommitted?: number,
    scrumAdded?: number,
  ): BoardHealthScore {
    const { totalItems, completedCount, onRoadmapCount, supportCount } = summary;

    if (totalItems === 0) {
      return { overall: 100, roadmapAlignmentScore: 100, supportBurdenScore: 100, stabilityScore: 100 };
    }

    const roadmapAlignmentScore =
      completedCount === 0
        ? 100
        : Math.round((onRoadmapCount / completedCount) * 100);

    const supportBurdenScore = Math.round((1 - supportCount / totalItems) * 100);

    // Stability:
    // Scrum  — committed / (committed + added) across overlapping sprints.
    //          Uses sprint-lifetime membership data (same as planning report).
    //          100% when no sprint members exist yet (proposal 0070).
    // Kanban — throughput balance: min(completed / entered, 1) * 100.
    //          A kanban team is stable when it completes as much as it pulls in
    //          (ADR 0062). Over-delivery is capped at 100 — clearing a backlog
    //          is not penalised.
    let stabilityScore: number;
    if (boardType === 'kanban') {
      stabilityScore = Math.round(Math.min(completedCount / totalItems, 1) * 100);
    } else {
      const totalSprintItems = (scrumCommitted ?? 0) + (scrumAdded ?? 0);
      stabilityScore = totalSprintItems === 0
        ? 100
        : Math.round((scrumCommitted ?? 0) / totalSprintItems * 100);
    }

    // Support burden is informational only — excluded from overall to avoid
    // penalising teams for support work they have no control over.
    const overall = Math.round((roadmapAlignmentScore + stabilityScore) / 2);

    return { overall, roadmapAlignmentScore, supportBurdenScore, stabilityScore };
  }

  // ---------------------------------------------------------------------------
  // Totals aggregation
  // ---------------------------------------------------------------------------

  private aggregateTotals(boards: AllItemsBoardResult[]): AllItemsTotals {
    const totals: AllItemsTotals = {
      totalItems: 0,
      startedCount: 0,
      addedMidSprintCount: 0,
      completedCount: 0,
      onRoadmapCount: 0,
      supportCount: 0,
      ttbSupportCount: 0,
      inFlightCount: 0,
    };
    for (const board of boards) {
      totals.totalItems += board.summary.totalItems;
      totals.startedCount += board.summary.startedCount;
      totals.addedMidSprintCount += board.summary.addedMidSprintCount;
      totals.completedCount += board.summary.completedCount;
      totals.onRoadmapCount += board.summary.onRoadmapCount;
      totals.supportCount += board.summary.supportCount;
      totals.ttbSupportCount += board.summary.ttbSupportCount;
      totals.inFlightCount += board.summary.inFlightCount;
    }
    return totals;
  }

  /**
   * Mean of all boards' health scores for the period.
   * Boards with no items contribute 100 (healthy by default — no signal).
   * Returns 100 when there are no boards.
   */
  private calculateOverallScore(boards: AllItemsBoardResult[]): number {
    if (boards.length === 0) return 100;
    const sum = boards.reduce((acc, b) => acc + b.healthScore.overall, 0);
    return Math.round(sum / boards.length);
  }

  // ---------------------------------------------------------------------------
  // Roadmap idea loading (called once per request, shared across all boards)
  // ---------------------------------------------------------------------------

  private async loadAllIdeas(): Promise<{
    allIdeas: JpdIdea[];
    ruleByJpdKey: Map<string, EpicConflictResolution>;
  }> {
    const roadmapConfigs = await this.roadmapConfigRepo.find();
    const allIdeas: JpdIdea[] = [];
    const ruleByJpdKey = new Map<string, EpicConflictResolution>();

    if (roadmapConfigs.length > 0) {
      const jpdKeys = roadmapConfigs.map((c) => c.jpdKey);
      for (const c of roadmapConfigs) {
        ruleByJpdKey.set(c.jpdKey, (c.epicConflictResolution as EpicConflictResolution) ?? 'earliest');
      }
      const ideas = await this.jpdIdeaRepo.find({ where: { jpdKey: In(jpdKeys) } });
      allIdeas.push(...ideas);
    }

    return { allIdeas, ruleByJpdKey };
  }

  // ---------------------------------------------------------------------------
  // Empty result builder
  // ---------------------------------------------------------------------------

  private emptyBoardResult(
    boardId: string,
    boardType: 'scrum' | 'kanban',
  ): AllItemsBoardResult {
    const summary: AllItemsBoardSummary = {
      totalItems: 0,
      startedCount: 0,
      addedMidSprintCount: 0,
      completedCount: 0,
      onRoadmapCount: 0,
      supportCount: 0,
      ttbSupportCount: 0,
      inFlightCount: 0,
    };
    return {
      boardId,
      boardType,
      items: [],
      summary,
      healthScore: { overall: 100, roadmapAlignmentScore: 100, supportBurdenScore: 100, stabilityScore: 100 },
    };
  }
}
