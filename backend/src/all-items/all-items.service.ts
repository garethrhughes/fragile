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
import { dateParts, startOfDayInTz } from '../metrics/tz-utils.js';
import { SprintMembershipService } from '../sprint-membership/sprint-membership.service.js';
import {
  resolveEpicIdeas,
  type EpicConflictResolution,
} from '../roadmap/resolve-epic-ideas.js';
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
    const { weekStart, weekEnd } = this.parseWeek(week);
    const filters = this.parseFilters(filterParam);

    const configs = await this.boardConfigRepo.find();

    if (configs.length === 0) {
      return {
        week,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        boards: [],
        totals: { totalItems: 0, startedCount: 0, addedMidSprintCount: 0, completedCount: 0, onRoadmapCount: 0, supportCount: 0, ttbSupportCount: 0 },
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
    const doneStatuses = new Set(config.doneStatusNames ?? ['Done', 'Closed', 'Released']);
    const inProgressStatuses = new Set(config.inProgressStatusNames ?? ['In Progress']);
    const boardEntryStatuses = new Set(
      (config.boardEntryStatuses ?? ['To Do']).map((s) => s.toLowerCase()),
    );

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

    if (isKanban) {
      // Kanban: include only issues whose board-entry date is within the week.
      workingSet = allBoardIssues.filter((issue) => {
        const statusLogs = statusChangelogsByIssue.get(issue.key) ?? [];
        const entryDate = this.detectBoardEntryDate(statusLogs, boardEntryStatuses);
        return entryDate !== null && entryDate >= weekStart && entryDate <= weekEnd;
      });
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

    if (workingSet.length === 0) {
      return this.emptyBoardResult(boardId, isKanban ? 'kanban' : 'scrum');
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
    if (supportLinkTypes.length > 0 && triageBoardKey) {
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
      // kanbanAdd: issue is in working set because its board-entry date is in the week
      const kanbanAdd = isKanban;

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
      });
    }

    // Apply filters and build summary from the full (unfiltered) working set
    const filteredItems = this.applyFilters(items, filters);
    const summary = this.buildSummary(items);

    // Kanban fix (proposal 0065): completedCount and onRoadmapCount must be
    // computed over ALL board issues that completed this week — not just those
    // whose board-entry fell within the week. Most kanban items complete in a
    // later week than they entered.
    if (isKanban) {
      let kanbanCompletedCount = 0;
      let kanbanOnRoadmapCount = 0;
      for (const issue of allBoardIssues) {
        const statusLogs = statusChangelogsByIssue.get(issue.key) ?? [];
        const completedAt = this.detectCompletionDate(statusLogs, doneStatuses, weekStart, weekEnd);
        if (completedAt !== null) {
          kanbanCompletedCount++;
          if (this.classifyRoadmap(issue, completedAt, epicIdeaMap, directLinkIdeaMap)) {
            kanbanOnRoadmapCount++;
          }
        }
      }
      summary.completedCount = kanbanCompletedCount;
      summary.onRoadmapCount = kanbanOnRoadmapCount;
    }

    const healthScore = this.calculateHealthScore(summary, isKanban ? 'kanban' : 'scrum');

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
    doneStatuses: Set<string>,
    weekStart: Date,
    weekEnd: Date,
  ): Date | null {
    const lastDoneInWindow = [...statusLogs]
      .reverse()
      .find(
        (cl) =>
          cl.toValue !== null &&
          doneStatuses.has(cl.toValue) &&
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
    // Only mark onRoadmap=true for items completed on or before the idea target date
    if (completedAt === null) return false;

    const epicIdea = issue.epicKey ? epicIdeaMap.get(issue.epicKey) : undefined;
    const directIdea = directLinkIdeaMap.get(issue.key);
    const idea = epicIdea ?? directIdea;
    if (!idea) return false;

    const targetEndOfDay = new Date(idea.targetDate.getTime());
    targetEndOfDay.setUTCHours(23, 59, 59, 999);
    return completedAt <= targetEndOfDay;
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

  private buildSummary(items: AllItemsIssue[]): AllItemsBoardSummary {
    return {
      totalItems: items.length,
      startedCount: items.filter((i) => i.started).length,
      addedMidSprintCount: items.filter((i) => i.addedMidSprint || i.kanbanAdd).length,
      completedCount: items.filter((i) => i.completed).length,
      onRoadmapCount: items.filter((i) => i.onRoadmap).length,
      supportCount: items.filter((i) => i.isSupport).length,
      ttbSupportCount: items.filter((i) => i.isTtbSupport).length,
    };
  }

  private calculateHealthScore(
    summary: AllItemsBoardSummary,
    boardType: 'scrum' | 'kanban',
  ): BoardHealthScore {
    const { totalItems, completedCount, onRoadmapCount, supportCount, addedMidSprintCount } = summary;

    if (totalItems === 0) {
      return { overall: 100, roadmapAlignmentScore: 100, supportBurdenScore: 100, stabilityScore: 100 };
    }

    const roadmapAlignmentScore =
      completedCount === 0
        ? 100
        : Math.round((onRoadmapCount / completedCount) * 100);

    const supportBurdenScore = Math.round((1 - supportCount / totalItems) * 100);

    // Stability:
    // Scrum  — disruption ratio: penalises unplanned mid-sprint additions.
    // Kanban — throughput balance: min(completed / entered, 1) * 100.
    //          A kanban team is stable when it completes as much as it pulls in
    //          (ADR 0062). Over-delivery is capped at 100 — clearing a backlog
    //          is not penalised.
    const stabilityScore =
      boardType === 'kanban'
        ? Math.round(Math.min(completedCount / totalItems, 1) * 100)
        : Math.round((1 - addedMidSprintCount / totalItems) * 100);

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
    };
    for (const board of boards) {
      totals.totalItems += board.summary.totalItems;
      totals.startedCount += board.summary.startedCount;
      totals.addedMidSprintCount += board.summary.addedMidSprintCount;
      totals.completedCount += board.summary.completedCount;
      totals.onRoadmapCount += board.summary.onRoadmapCount;
      totals.supportCount += board.summary.supportCount;
      totals.ttbSupportCount += board.summary.ttbSupportCount;
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
  // Week parsing (matches WeekDetailService.parseWeek logic)
  // ---------------------------------------------------------------------------

  private parseWeek(week: string): { weekStart: Date; weekEnd: Date } {
    const match = week.match(/^(\d{4})-W(\d{2})$/);
    if (!match) {
      throw new BadRequestException(
        `Invalid week format: "${week}". Expected YYYY-Www e.g. 2026-W20`,
      );
    }

    const year = parseInt(match[1], 10);
    const weekNum = parseInt(match[2], 10);
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');

    const jan4LocalParts = dateParts(new Date(Date.UTC(year, 0, 4)), tz);
    const jan4LocalDate = new Date(Date.UTC(jan4LocalParts.year, jan4LocalParts.month, jan4LocalParts.day));
    const jan4Dow = jan4LocalDate.getUTCDay();
    const daysToMon = jan4Dow === 0 ? -6 : 1 - jan4Dow;
    const week1MondayLocal = new Date(jan4LocalDate);
    week1MondayLocal.setUTCDate(jan4LocalDate.getUTCDate() + daysToMon);

    const weekMondayLocal = new Date(week1MondayLocal);
    weekMondayLocal.setUTCDate(week1MondayLocal.getUTCDate() + (weekNum - 1) * 7);

    const weekSundayLocal = new Date(weekMondayLocal);
    weekSundayLocal.setUTCDate(weekMondayLocal.getUTCDate() + 6);

    const weekStart = startOfDayInTz(
      weekMondayLocal.getUTCFullYear(),
      weekMondayLocal.getUTCMonth(),
      weekMondayLocal.getUTCDate(),
      tz,
    );
    const dayAfterWeekEnd = startOfDayInTz(
      weekSundayLocal.getUTCFullYear(),
      weekSundayLocal.getUTCMonth(),
      weekSundayLocal.getUTCDate() + 1,
      tz,
    );
    const weekEnd = new Date(dayAfterWeekEnd.getTime() - 1);

    return { weekStart, weekEnd };
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
