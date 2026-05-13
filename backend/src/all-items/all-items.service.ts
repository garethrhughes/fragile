/**
 * AllItemsService — weekly cross-board activity report.
 *
 * NOTE: Bespoke MyPass-only report (feature 0012, proposal 0062).
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

    return {
      week,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      boards: boardResults,
      totals,
    };
  }

  // ---------------------------------------------------------------------------
  // Per-board processing
  // ---------------------------------------------------------------------------

  private async processBoardForWeek(
    config: BoardConfig,
    week: string,
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

    // --- Load work items ---
    const allIssues = (await this.issueRepo.find({ where: { boardId } })).filter(
      (i) => isWorkItem(i.issueType),
    );

    if (allIssues.length === 0) {
      return this.emptyBoardResult(boardId, isKanban ? 'kanban' : 'scrum', filters);
    }

    const issueKeys = allIssues.map((i) => i.key);

    // --- Load changelogs (status + Sprint fields) ---
    const allChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
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

    // --- Sprint membership (scrum) ---
    let addedMidSprintKeys = new Set<string>();
    let allSprintMemberKeys = new Set<string>();
    let sprintNameByIssue = new Map<string, string>();

    if (!isKanban) {
      const sprints = await this.sprintRepo.find({ where: { boardId } });
      const activeSprints = sprints.filter((s) => s.state === 'active' || s.state === 'closed');

      if (activeSprints.length > 0) {
        const membershipMap = await this.sprintMembership.reconstructMany({
          sprints: activeSprints,
          boardId,
          boardIssues: allIssues,
        });

        for (const sprint of activeSprints) {
          const m = membershipMap.get(sprint.id);
          if (!m) continue;
          for (const key of m.addedKeys) {
            addedMidSprintKeys.add(key);
            sprintNameByIssue.set(key, sprint.name);
          }
          for (const key of [...m.committedKeys, ...m.addedKeys, ...m.currentMemberKeys]) {
            allSprintMemberKeys.add(key);
            if (!sprintNameByIssue.has(key)) {
              sprintNameByIssue.set(key, sprint.name);
            }
          }
        }
      }
    }

    // --- Support classification ---
    const supportLabels: string[] = config.supportLabels ?? [];
    const supportLinkTypes: string[] = config.supportLinkTypes ?? [];
    const supportEpics: string[] = (config.supportEpics ?? []).map((e) => e.toUpperCase());
    const triageBoardKey: string | null = config.triageBoardKey ?? null;
    const triagePrefix = triageBoardKey ? `${triageBoardKey}-` : null;

    const linksByIssue = new Map<string, JiraIssueLink[]>();
    if (supportLinkTypes.length > 0 && triageBoardKey) {
      const links = await this.issueLinkRepo
        .createQueryBuilder('lnk')
        .where('lnk.sourceIssueKey IN (:...keys)', { keys: issueKeys })
        .getMany();
      for (const lnk of links) {
        const list = linksByIssue.get(lnk.sourceIssueKey) ?? [];
        list.push(lnk);
        linksByIssue.set(lnk.sourceIssueKey, list);
      }
    }

    // --- Roadmap ideas (passed in from caller — loaded once for all boards) ---
    // Filter ideas to those overlapping the week window
    const epicIdeaMap = this.filterIdeasForWindow(allIdeas, weekStart, weekEnd, ruleByJpdKey);

    // Direct-link roadmap coverage (ADR 0044)
    const roadmapLinkTypes: string[] = config.roadmapLinkTypes ?? [];
    const directLinkIdeaMap = await buildDirectLinkIdeaMap(
      this.issueLinkRepo,
      issueKeys,
      allIdeas,
      roadmapLinkTypes,
      ruleByJpdKey,
    );

    // --- Classify each issue ---
    const items: AllItemsIssue[] = [];

    for (const issue of allIssues) {
      const statusLogs = statusChangelogsByIssue.get(issue.key) ?? [];

      // --- started flag ---
      const started = this.detectStarted(
        issue,
        statusLogs,
        inProgressStatuses,
        boardEntryStatuses,
        isKanban,
        weekStart,
        weekEnd,
      );

      // --- completed flag ---
      const completedAt = this.detectCompletionDate(statusLogs, doneStatuses, weekStart, weekEnd);
      const completed = completedAt !== null;

      // --- addedMidSprint / kanbanAdd ---
      let addedMidSprint = false;
      let kanbanAdd = false;

      if (!isKanban) {
        addedMidSprint = addedMidSprintKeys.has(issue.key);
      } else {
        // kanbanAdd: first board-entry transition is within the week
        const entryDate = this.detectBoardEntryDate(issue, statusLogs, boardEntryStatuses);
        if (entryDate !== null && entryDate >= weekStart && entryDate <= weekEnd) {
          kanbanAdd = true;
        }
      }

      // --- onRoadmap flag ---
      const onRoadmap = this.classifyRoadmap(
        issue,
        completedAt,
        epicIdeaMap,
        directLinkIdeaMap,
      );

      // --- support flags ---
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

    // --- Apply filters ---
    const filteredItems = this.applyFilters(items, filters);

    // --- Summaries and health score ---
    const summary = this.buildSummary(items); // always from unfiltered set
    const healthScore = this.calculateHealthScore(summary);

    return {
      boardId,
      boardType: isKanban ? 'kanban' : 'scrum',
      items: filteredItems,
      summary,
      healthScore,
    };
  }

  // ---------------------------------------------------------------------------
  // Classification helpers
  // ---------------------------------------------------------------------------

  private detectStarted(
    issue: JiraIssue,
    statusLogs: JiraChangelog[],
    inProgressStatuses: Set<string>,
    boardEntryStatuses: Set<string>,
    isKanban: boolean,
    weekStart: Date,
    weekEnd: Date,
  ): boolean {
    if (isKanban) {
      // For kanban: first transition to a board-entry status within the week
      const entryDate = this.detectBoardEntryDate(issue, statusLogs, boardEntryStatuses);
      return entryDate !== null && entryDate >= weekStart && entryDate <= weekEnd;
    }

    // For scrum: first in-progress transition ever is within the week
    const firstInProgress = statusLogs.find((cl) =>
      cl.toValue !== null && inProgressStatuses.has(cl.toValue),
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
    issue: JiraIssue,
    statusLogs: JiraChangelog[],
    boardEntryStatuses: Set<string>,
  ): Date | null {
    // First transition to a board-entry status (case-insensitive)
    const entry = statusLogs.find(
      (cl) =>
        cl.toValue !== null &&
        boardEntryStatuses.has(cl.toValue.toLowerCase()),
    );
    if (entry) return entry.changedAt;
    // Fallback: if there are status logs but no entry-status match, use createdAt
    if (statusLogs.length > 0) return null;
    return null;
  }

  private classifyRoadmap(
    issue: JiraIssue,
    completedAt: Date | null,
    epicIdeaMap: Map<string, { targetDate: Date }>,
    directLinkIdeaMap: Map<string, { targetDate: Date }>,
  ): boolean {
    // Only mark onRoadmap=true for completed items that were delivered on time
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

  private calculateHealthScore(summary: AllItemsBoardSummary): BoardHealthScore {
    const { totalItems, completedCount, onRoadmapCount, supportCount, addedMidSprintCount } = summary;

    if (totalItems === 0) {
      return { overall: 100, roadmapAlignmentScore: 100, supportBurdenScore: 100, stabilityScore: 100 };
    }

    const roadmapAlignmentScore =
      completedCount === 0
        ? 100
        : Math.round((onRoadmapCount / completedCount) * 100);

    const supportBurdenScore = Math.round((1 - supportCount / totalItems) * 100);
    const stabilityScore = Math.round((1 - addedMidSprintCount / totalItems) * 100);

    const overall = Math.round((roadmapAlignmentScore + supportBurdenScore + stabilityScore) / 3);

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
  // Empty result builders
  // ---------------------------------------------------------------------------

  private emptyBoardResult(
    boardId: string,
    boardType: 'scrum' | 'kanban',
    _filters: Set<ActiveFilter>,
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
