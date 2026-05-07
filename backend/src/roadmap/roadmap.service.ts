import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  JpdIdea,
  JiraIssueLink,
  RoadmapConfig,
  BoardConfig,
} from '../database/entities/index.js';
import { SyncService } from '../sync/sync.service.js';
import { SprintMembershipService } from '../sprint-membership/sprint-membership.service.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { dateParts, midnightInTz } from '../metrics/tz-utils.js';
import { dateToIsoWeekKey } from '../lib/iso-week.js';
import { buildDirectLinkIdeaMap } from '../metrics/roadmap-link-utils.js';
import {
  resolveEpicIdeas,
  type EpicConflictResolution,
  type ResolveIdeaInput,
} from './resolve-epic-ideas.js';

export interface RoadmapSprintAccuracy {
  sprintId: string;
  sprintName: string;
  state: string;
  startDate: string | null;
  totalIssues: number;
  coveredIssues: number;
  uncoveredIssues: number;
  /**
   * Number of issues linked to a roadmap idea (green + amber).
   * Used by the frontend to compute a weighted on-time rate denominator.
   */
  linkedCount: number;
  roadmapCoverage: number;
  /**
   * On-time delivery rate: green ÷ (green + amber).
   * = issues delivered on or before targetDate ÷ all roadmap-linked issues.
   * 0 when there are no roadmap-linked issues.
   */
  roadmapOnTimeRate: number;
}

interface RoadmapItemWindow {
  ideaKey: string;
  startDate: Date;
  targetDate: Date;
}

@Injectable()
export class RoadmapService {
  private readonly logger = new Logger(RoadmapService.name);

  constructor(
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JpdIdea)
    private readonly jpdIdeaRepo: Repository<JpdIdea>,
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
    @InjectRepository(RoadmapConfig)
    private readonly roadmapConfigRepo: Repository<RoadmapConfig>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    @Inject(forwardRef(() => SyncService))
    private readonly syncService: SyncService,
    private readonly configService: ConfigService,
    private readonly sprintMembership: SprintMembershipService,
  ) {}

  async getAccuracy(
    boardId: string,
    sprintId?: string,
    quarter?: string,
    week?: string,
    weekMode?: boolean,
  ): Promise<RoadmapSprintAccuracy[]> {
    const boardConfig = await this.boardConfigRepo.findOne({ where: { boardId } });
    const isKanban = boardConfig?.boardType === 'kanban';

    // Kanban boards have no sprints — sprintId filter is unsupported
    if (isKanban && sprintId) {
      throw new BadRequestException(
        'Sprint-level accuracy is not available for Kanban boards. Use quarter mode instead.',
      );
    }

    if (isKanban && week) {
      return this.getKanbanWeeklyAccuracy(boardId, boardConfig, week);
    }

    // weekMode=true on a Kanban board: return all weeks without filtering
    if (isKanban && weekMode) {
      return this.getKanbanWeeklyAccuracy(boardId, boardConfig, undefined);
    }

    if (isKanban) {
      return this.getKanbanAccuracy(boardId, boardConfig, quarter);
    }

    // Resolve sprints
    let sprints: JiraSprint[];

    if (sprintId) {
      const sprint = await this.sprintRepo.findOne({ where: { id: sprintId, boardId } });
      sprints = sprint ? [sprint] : [];
    } else if (quarter) {
      const { startDate, endDate } = this.quarterToDates(quarter);
      sprints = await this.sprintRepo
        .createQueryBuilder('s')
        .where('s.boardId = :boardId', { boardId })
        .andWhere('s.state = :state', { state: 'closed' })
        .andWhere('s.startDate >= :start', { start: startDate })
        .andWhere('s.endDate <= :end', { end: endDate })
        .orderBy('s.startDate', 'ASC')
        .getMany();
    } else {
      // Active first, then closed descending
      const active = await this.sprintRepo.find({
        where: { boardId, state: 'active' },
        order: { startDate: 'DESC' },
      });
      const closed = await this.sprintRepo.find({
        where: { boardId, state: 'closed' },
        order: { startDate: 'DESC' },
      });
      sprints = [...active, ...closed];
    }

    // Resolve doneStatusNames and cancelledStatusNames from board config
    const doneStatusNames: string[] =
      boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const cancelledStatusNames: string[] =
      boardConfig?.cancelledStatusNames ?? ['Cancelled', "Won't Do"];

    if (sprints.length === 0) {
      return [];
    }

    // Load ALL board issues — we cannot rely on the sprintId column because
    // Jira only stores the *current* sprint on an issue.  Issues from recently-
    // closed sprints will have had their sprintId updated to the active sprint
    // by the last sync, making a WHERE sprintId IN (...) query miss them entirely.
    const allBoardIssues = (await this.issueRepo.find({ where: { boardId } })).filter(
      (i) => isWorkItem(i.issueType),
    );

    if (allBoardIssues.length === 0) {
      return this.emptyAccuracyForSprints(sprints);
    }

    const issueByKey = new Map<string, JiraIssue>(allBoardIssues.map((i) => [i.key, i]));

    // Reconstruct membership for all target sprints in one pass via the
    // canonical SprintMembershipService (ADR 0049). Roadmap semantics:
    // an issue belongs to a sprint if it was a member at *any point* during
    // the sprint window — i.e. committed (in at start, including carry-overs)
    // OR added mid-sprint. Removed-mid-sprint issues are still included
    // because they consumed sprint capacity.
    const membershipBySprint = await this.sprintMembership.reconstructMany({
      sprints,
      boardId,
      boardIssues: allBoardIssues,
    });

    // Materialise issue lists per sprint as the union of committed + added.
    const issueListBySprint = new Map<string, JiraIssue[]>();
    for (const sprint of sprints) {
      const m = membershipBySprint.get(sprint.id);
      const keys = new Set<string>();
      if (m) {
        for (const k of m.committedKeys) keys.add(k);
        for (const k of m.addedKeys) keys.add(k);
      }
      issueListBySprint.set(
        sprint.id,
        [...keys].map((k) => issueByKey.get(k)!).filter(Boolean),
      );
    }

    // Load all roadmap ideas once — filter per-sprint in memory
    const { ideas: allIdeasForSprints, ruleByJpdKey } = await this.loadAllIdeas();

    const results: RoadmapSprintAccuracy[] = [];
    for (const sprint of sprints) {
      const sprintIssues = issueListBySprint.get(sprint.id) ?? [];
      const inProgressStatusNames: string[] =
        boardConfig?.inProgressStatusNames ?? ['In Progress'];
      const roadmapLinkTypes: string[] = boardConfig?.roadmapLinkTypes ?? [];
      const accuracy = await this.calculateSprintAccuracy(
        sprint,
        sprintIssues,
        doneStatusNames,
        cancelledStatusNames,
        allIdeasForSprints,
        inProgressStatusNames,
        roadmapLinkTypes,
        ruleByJpdKey,
      );
      results.push(accuracy);
    }

    return results;
  }

  /**
   * For Kanban boards: group issues by the quarter in which they were first
   * moved off "To Do" (i.e. pulled onto the board). Falls back to createdAt
   * for issues that have no such changelog entry.
   */
  private async getKanbanAccuracy(
    boardId: string,
    boardConfig: BoardConfig | null,
    quarter?: string,
  ): Promise<RoadmapSprintAccuracy[]> {
    const doneStatusNames: string[] =
      boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const backlogStatusIds: string[] = boardConfig?.backlogStatusIds ?? [];

    // Load all Kanban issues for this board, excluding Epics and Sub-tasks
    const allIssues = (await this.issueRepo.find({ where: { boardId } })).filter(
      (i) => isWorkItem(i.issueType),
    );

    if (allIssues.length === 0) {
      return [];
    }

    const issueKeys = allIssues.map((i) => i.key);

    // Bulk-load status changelogs for all these issues in one query
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .andWhere('cl.fromValue = :from', { from: 'To Do' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Build map: issueKey → earliest date it left "To Do"
    const boardEntryDate = new Map<string, Date>();
    for (const cl of changelogs) {
      if (!boardEntryDate.has(cl.issueKey)) {
        boardEntryDate.set(cl.issueKey, cl.changedAt);
      }
    }

    // Build set of issue keys that have any status changelog (fallback heuristic)
    const issueKeysWithChangelog = new Set<string>(changelogs.map((cl) => cl.issueKey));
    if (backlogStatusIds.length === 0) {
      const anyStatusChangelogs = await this.changelogRepo
        .createQueryBuilder('cl')
        .select('DISTINCT cl."issueKey"', 'issueKey')
        .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
        .andWhere('cl.field = :field', { field: 'status' })
        .getRawMany<{ issueKey: string }>();
      for (const row of anyStatusChangelogs) {
        issueKeysWithChangelog.add(row.issueKey);
      }
    }

    // Exclude pure-backlog issues
    const onBoardIssues = allIssues.filter((issue) => {
      if (backlogStatusIds.length > 0) {
        if (issue.statusId !== null) {
          return !backlogStatusIds.includes(issue.statusId);
        }
      }
      return issueKeysWithChangelog.has(issue.key);
    });

    if (onBoardIssues.length === 0) {
      return [];
    }

    // Apply dataStartDate lower bound filter if configured
    const dataStartDate = boardConfig?.dataStartDate ?? null;
    const startBound = dataStartDate ? new Date(dataStartDate) : null;
    const boundedIssues = startBound
      ? onBoardIssues.filter((issue) => {
          const entryDate = boardEntryDate.get(issue.key) ?? issue.createdAt;
          return entryDate >= startBound;
        })
      : onBoardIssues;

    if (boundedIssues.length === 0) {
      return [];
    }

    // Bulk-load all status changelogs for completion date / activity-start mapping
    const allBoundedKeys = boundedIssues.map((i) => i.key);
    const doneChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allBoundedKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Build map: issueKey → first done-transition changedAt
    const completionDates = new Map<string, Date>();
    // Build map: issueKey → first non-done transition changedAt (activity start).
    // NOTE: The Kanban path defines "activity start" as the first transition TO a
    // non-done status (i.e. the first time work was picked up or re-opened). The
    // sprint path (calculateSprintAccuracy) instead uses the first status transition
    // of *any* kind. The difference is low-risk — it only affects re-opened issues —
    // but is intentional: Kanban activity-start is board-pull semantics, sprint
    // activity-start is first-touch semantics. Both paths fall back to createdAt
    // when no changelog entry exists.
    const activityStartDates = new Map<string, Date>();
    for (const cl of doneChangelogs) {
      if (cl.toValue !== null && doneStatusNames.includes(cl.toValue)) {
        if (!completionDates.has(cl.issueKey)) {
          completionDates.set(cl.issueKey, cl.changedAt);
        }
      } else {
        // First transition to a non-done status = activity start
        if (!activityStartDates.has(cl.issueKey)) {
          activityStartDates.set(cl.issueKey, cl.changedAt);
        }
      }
    }

    // Group issues by the quarter of their board-entry date (fall back to createdAt)
    const quarterMap = new Map<string, JiraIssue[]>();
    for (const issue of boundedIssues) {
      const entryDate = boardEntryDate.get(issue.key) ?? issue.createdAt;
      const key = this.issueToQuarterKey(entryDate);
      const list = quarterMap.get(key) ?? [];
      list.push(issue);
      quarterMap.set(key, list);
    }

    // Filter to requested quarter if provided; otherwise all, newest first
    const filteredKeys = quarter
      ? Array.from(quarterMap.keys()).filter((k) => k === quarter)
      : Array.from(quarterMap.keys()).sort((a, b) => b.localeCompare(a));

    const now = new Date();
    const currentQuarterKey = this.issueToQuarterKey(now);

    // Load all ideas once — filter per-quarter in memory (avoids N×2 DB queries)
    const { ideas: allIdeas, ruleByJpdKey } = await this.loadAllIdeas();

    const results: RoadmapSprintAccuracy[] = [];
    for (const qKey of filteredKeys) {
      const issues = quarterMap.get(qKey)!;
      const { startDate, endDate } = this.quarterToDates(qKey);
      const state = qKey === currentQuarterKey ? 'active' : 'closed';

      const activeIdeas = this.filterIdeasForWindow(allIdeas, startDate, endDate, ruleByJpdKey);

      const eligibleCoveredIssues = issues.filter((i) => {
        if (i.epicKey === null || !activeIdeas.has(i.epicKey)) return false;
        const item = activeIdeas.get(i.epicKey)!;
        const issueActivityStart = activityStartDates.get(i.key) ?? i.createdAt;
        // null means in-flight (no done-transition yet) → always qualifies.
        // Non-null means completed at that timestamp; eligibility uses that date.
        const issueActivityEnd = completionDates.get(i.key) ?? null;
        return this.isIssueEligibleForRoadmapItem(issueActivityStart, issueActivityEnd, item);
      });
      const eligibleCoveredKeys = new Set(eligibleCoveredIssues.map((i) => i.key));

      const totalIssues = issues.length;
      const coveredCount = eligibleCoveredIssues.length;
      // Issues linked to any active idea but not covered (amber equivalent for Kanban)
      const linkedNotCoveredCount = issues.filter(
        (i) => i.epicKey !== null && activeIdeas.has(i.epicKey) && !eligibleCoveredKeys.has(i.key),
      ).length;
      const totalLinkedKanban = coveredCount + linkedNotCoveredCount;

      results.push({
        sprintId: qKey,
        sprintName: qKey,
        state,
        startDate: startDate.toISOString(),
        totalIssues,
        coveredIssues: coveredCount,
        uncoveredIssues: totalIssues - coveredCount,
        linkedCount: totalLinkedKanban,
        roadmapCoverage:
          totalIssues > 0
            ? Math.round((coveredCount / totalIssues) * 10000) / 100
            : 0,
        roadmapOnTimeRate:
          totalLinkedKanban > 0
            ? Math.round((coveredCount / totalLinkedKanban) * 10000) / 100
            : 0,
      });
    }

    return results;
  }

  /**
   * Load all JPD ideas from configured projects in a single pair of DB
   * queries. Returned ideas retain their raw date fields; use
   * filterIdeasForWindow() to apply a date-window filter in memory.
   *
   * Also returns `ruleByJpdKey` — the per-roadmap conflict resolution
   * policy (proposal 0053). Default 'earliest' is applied when a config
   * row predates the column or has it set to NULL via a hand-edit.
   */
  private async loadAllIdeas(): Promise<{
    ideas: JpdIdea[];
    ruleByJpdKey: Map<string, EpicConflictResolution>;
  }> {
    const configs = await this.roadmapConfigRepo.find();
    if (configs.length === 0) {
      return { ideas: [], ruleByJpdKey: new Map() };
    }
    const jpdKeys = configs.map((c) => c.jpdKey);
    const ruleByJpdKey = new Map<string, EpicConflictResolution>();
    for (const c of configs) {
      ruleByJpdKey.set(c.jpdKey, c.epicConflictResolution ?? 'earliest');
    }
    const ideas = await this.jpdIdeaRepo.find({ where: { jpdKey: In(jpdKeys) } });
    return { ideas, ruleByJpdKey };
  }

  /**
   * Filter a pre-loaded idea list to those whose delivery window overlaps
   * [windowStart, windowEnd], returning a Map keyed by epic key.
   * Ideas without both startDate and targetDate are excluded (decision 2).
   *
   * Conflict resolution (proposal 0053): when multiple ideas link the same
   * epic key, defer to the shared `resolveEpicIdeas` helper which honours
   * each roadmap's `epicConflictResolution` policy ('earliest' default,
   * 'latest' legacy override).
   *
   * This is pure in-memory arithmetic — no DB access.
   */
  private filterIdeasForWindow(
    ideas: JpdIdea[],
    windowStart: Date,
    windowEnd: Date,
    ruleByJpdKey: Map<string, EpicConflictResolution>,
  ): Map<string, RoadmapItemWindow> {
    // First, apply the date-window overlap filter in-memory. The helper
    // handles null start/target exclusion and conflict resolution.
    const inWindow: ResolveIdeaInput[] = [];
    for (const idea of ideas) {
      if (idea.startDate === null || idea.targetDate === null) continue;
      // Polaris interval fields store dates as date-only values (midnight UTC).
      // A sprint starting at e.g. 03:30 UTC on the same calendar day as an idea's
      // targetDate would incorrectly miss the overlap check because midnight < 03:30.
      // Extending targetDate to 23:59:59.999 UTC ensures a date-only targetDate
      // covers the full calendar day it represents.
      const ideaTargetEndOfDay = new Date(idea.targetDate.getTime());
      ideaTargetEndOfDay.setUTCHours(23, 59, 59, 999);
      if (ideaTargetEndOfDay < windowStart || idea.startDate > windowEnd) continue;
      inWindow.push(idea);
    }

    const resolved = resolveEpicIdeas(
      inWindow,
      (idea) => ruleByJpdKey.get((idea as JpdIdea).jpdKey) ?? 'earliest',
    );

    const result = new Map<string, RoadmapItemWindow>();
    for (const [epicKey, entry] of resolved) {
      result.set(epicKey, {
        ideaKey: entry.primaryIdea.ideaKey,
        startDate: entry.primaryIdea.startDate!,
        targetDate: entry.primaryIdea.targetDate,
      });
    }
    return result;
  }

  /**
   * Returns true if the issue's activity window overlaps the roadmap item's
   * delivery window.
   *
   * Per architect note: gate on issueActivityStart <= targetDate only (not
   * issueActivityEnd). E6: an issue that started before the target but
   * finished after it still counts — late delivery is a rate miss, not an
   * exclusion.
   *
   * issueActivityEnd === null means the issue is in-flight; it always
   * qualifies the afterStart side of the check (conservative).
   */
  private isIssueEligibleForRoadmapItem(
    issueActivityStart: Date,
    issueActivityEnd: Date | null,
    item: RoadmapItemWindow,
  ): boolean {
    // Issue must have started at or before the roadmap item's target date
    const beforeTarget = issueActivityStart <= item.targetDate;

    // Issue must not have been completed before the roadmap item's start date
    const afterStart =
      issueActivityEnd === null || // in-flight: always qualifies
      issueActivityEnd >= item.startDate;

    return beforeTarget && afterStart;
  }

  private issueToQuarterKey(date: Date): string {
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    const { year, month } = dateParts(date, tz);
    const q = Math.floor(month / 3) + 1;
    return `${year}-Q${q}`;
  }

  private dateToWeekKey(date: Date): string {
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    return dateToIsoWeekKey(date, tz);
  }

  private weekKeyToDates(week: string): { weekStart: Date; weekEnd: Date } {
    const match = week.match(/^(\d{4})-W(\d{2})$/);
    if (!match) {
      throw new BadRequestException(
        `Invalid week format: ${week}. Expected YYYY-Www`,
      );
    }

    const year = parseInt(match[1], 10);
    const weekNum = parseInt(match[2], 10);

    // Jan 4 is always in ISO week 1
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay();
    const daysToMon = jan4Day === 0 ? -6 : 1 - jan4Day;
    const mondayOfWeek1 = new Date(jan4);
    mondayOfWeek1.setUTCDate(jan4.getUTCDate() + daysToMon);

    const weekStart = new Date(mondayOfWeek1);
    weekStart.setUTCDate(mondayOfWeek1.getUTCDate() + (weekNum - 1) * 7);

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 999);

    return { weekStart, weekEnd };
  }

  /**
   * For Kanban boards: group issues by the ISO week in which they were first
   * moved off "To Do" (i.e. pulled onto the board).
   */
  private async getKanbanWeeklyAccuracy(
    boardId: string,
    boardConfig: BoardConfig | null,
    week?: string,
  ): Promise<RoadmapSprintAccuracy[]> {
    const doneStatusNames: string[] =
      boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const backlogStatusIds: string[] = boardConfig?.backlogStatusIds ?? [];

    // C-3: configurable board-entry status list — matches PlanningService.getKanbanWeeks.
    const boardEntryStatuses: string[] = boardConfig?.boardEntryStatuses ?? [
      'To Do', 'Backlog', 'Open', 'New', 'TODO', 'OPEN', 'Selected for Development',
    ];

    // Load all Kanban issues for this board, excluding Epics and Sub-tasks
    const allIssues = (await this.issueRepo.find({ where: { boardId } })).filter(
      (i) => isWorkItem(i.issueType),
    );

    if (allIssues.length === 0) {
      return [];
    }

    const issueKeys = allIssues.map((i) => i.key);

    // Bulk-load the earliest board-entry changelog per issue.
    // Board-entry = first transition *into* a boardEntryStatus (toValue IN list).
    // This matches PlanningService.getKanbanWeeks — the roadmap table and the
    // planning table now use the same bucketing logic.
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .andWhere('cl.toValue IN (:...statuses)', { statuses: boardEntryStatuses })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Build map: issueKey → earliest date it entered the board
    const boardEntryDate = new Map<string, Date>();
    for (const cl of changelogs) {
      if (!boardEntryDate.has(cl.issueKey)) {
        boardEntryDate.set(cl.issueKey, cl.changedAt);
      }
    }

    // Build set of issue keys that have any status changelog (fallback heuristic)
    const issueKeysWithChangelog = new Set<string>(changelogs.map((cl) => cl.issueKey));
    if (backlogStatusIds.length === 0) {
      const anyStatusChangelogs = await this.changelogRepo
        .createQueryBuilder('cl')
        .select('DISTINCT cl."issueKey"', 'issueKey')
        .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
        .andWhere('cl.field = :field', { field: 'status' })
        .getRawMany<{ issueKey: string }>();
      for (const row of anyStatusChangelogs) {
        issueKeysWithChangelog.add(row.issueKey);
      }
    }

    // Exclude pure-backlog issues
    const onBoardIssues = allIssues.filter((issue) => {
      if (backlogStatusIds.length > 0) {
        if (issue.statusId !== null) {
          return !backlogStatusIds.includes(issue.statusId);
        }
      }
      return issueKeysWithChangelog.has(issue.key);
    });

    if (onBoardIssues.length === 0) {
      return [];
    }

    // Apply dataStartDate lower bound filter if configured
    const dataStartDateWeekly = boardConfig?.dataStartDate ?? null;
    const startBoundWeekly = dataStartDateWeekly ? new Date(dataStartDateWeekly) : null;
    const boundedIssuesWeekly = startBoundWeekly
      ? onBoardIssues.filter((issue) => {
          const entryDate = boardEntryDate.get(issue.key) ?? issue.createdAt;
          return entryDate >= startBoundWeekly;
        })
      : onBoardIssues;

    if (boundedIssuesWeekly.length === 0) {
      return [];
    }

    // Bulk-load done-transition changelogs for completion date / activity-start mapping
    const allWeeklyKeys = boundedIssuesWeekly.map((i) => i.key);
    const doneChangelogsWeekly = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allWeeklyKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Build map: issueKey → first done-transition changedAt
    const completionDatesWeekly = new Map<string, Date>();
    // Build map: issueKey → first non-done transition changedAt (activity start).
    // NOTE: See getKanbanAccuracy for a note on the intentional difference between
    // this Kanban "board-pull semantics" definition and the sprint path's
    // "first-touch semantics" in calculateSprintAccuracy.
    const activityStartDatesWeekly = new Map<string, Date>();
    for (const cl of doneChangelogsWeekly) {
      if (cl.toValue !== null && doneStatusNames.includes(cl.toValue)) {
        if (!completionDatesWeekly.has(cl.issueKey)) {
          completionDatesWeekly.set(cl.issueKey, cl.changedAt);
        }
      } else {
        if (!activityStartDatesWeekly.has(cl.issueKey)) {
          activityStartDatesWeekly.set(cl.issueKey, cl.changedAt);
        }
      }
    }

    // Group issues by the week of their board-entry date (fall back to createdAt)
    const weekMap = new Map<string, JiraIssue[]>();
    for (const issue of boundedIssuesWeekly) {
      const entryDate = boardEntryDate.get(issue.key) ?? issue.createdAt;
      const key = this.dateToWeekKey(entryDate);
      const list = weekMap.get(key) ?? [];
      list.push(issue);
      weekMap.set(key, list);
    }

    // Filter to requested week if provided; otherwise all, newest first
    const filteredKeys = week
      ? Array.from(weekMap.keys()).filter((k) => k === week)
      : Array.from(weekMap.keys()).sort((a, b) => b.localeCompare(a));

    const now = new Date();
    const currentWeekKey = this.dateToWeekKey(now);

    // Load all ideas once — filter per-week in memory (avoids N×2 DB queries)
    const { ideas: allIdeasWeekly, ruleByJpdKey: ruleByJpdKeyWeekly } = await this.loadAllIdeas();

    const results: RoadmapSprintAccuracy[] = [];
    for (const wKey of filteredKeys) {
      const issues = weekMap.get(wKey)!;
      const { weekStart, weekEnd } = this.weekKeyToDates(wKey);
      const state = wKey === currentWeekKey ? 'active' : 'closed';

      const activeIdeas = this.filterIdeasForWindow(allIdeasWeekly, weekStart, weekEnd, ruleByJpdKeyWeekly);

      const eligibleCoveredIssues = issues.filter((i) => {
        if (i.epicKey === null || !activeIdeas.has(i.epicKey)) return false;
        const item = activeIdeas.get(i.epicKey)!;
        const issueActivityStart = activityStartDatesWeekly.get(i.key) ?? i.createdAt;
        // null means in-flight (no done-transition yet) → always qualifies.
        // Non-null means completed at that timestamp; eligibility uses that date.
        const issueActivityEnd = completionDatesWeekly.get(i.key) ?? null;
        return this.isIssueEligibleForRoadmapItem(issueActivityStart, issueActivityEnd, item);
      });
      const eligibleCoveredKeys = new Set(eligibleCoveredIssues.map((i) => i.key));

      const totalIssues = issues.length;
      const coveredCount = eligibleCoveredIssues.length;
      // Issues linked to any active idea but not covered (amber equivalent for Kanban weekly)
      const linkedNotCoveredCountWeekly = issues.filter(
        (i) => i.epicKey !== null && activeIdeas.has(i.epicKey) && !eligibleCoveredKeys.has(i.key),
      ).length;
      const totalLinkedWeekly = coveredCount + linkedNotCoveredCountWeekly;

      results.push({
        sprintId: wKey,
        sprintName: wKey,
        state,
        startDate: weekStart.toISOString(),
        totalIssues,
        coveredIssues: coveredCount,
        uncoveredIssues: totalIssues - coveredCount,
        linkedCount: totalLinkedWeekly,
        roadmapCoverage:
          totalIssues > 0
            ? Math.round((coveredCount / totalIssues) * 10000) / 100
            : 0,
        roadmapOnTimeRate:
          totalLinkedWeekly > 0
            ? Math.round((coveredCount / totalLinkedWeekly) * 10000) / 100
            : 0,
      });
    }

    return results;
  }

  private async calculateSprintAccuracy(
    sprint: JiraSprint,
    sprintIssues: JiraIssue[],
    doneStatusNames: string[],
    cancelledStatusNames: string[],
    allIdeas: JpdIdea[],
    _inProgressStatusNames: string[], // accepted for API clarity; not used in core predicate
    roadmapLinkTypes: string[] = [],
    ruleByJpdKey: Map<string, EpicConflictResolution> = new Map(),
  ): Promise<RoadmapSprintAccuracy> {
    // Exclude Epics and Sub-tasks (per ADR 0018). Cancelled issues remain in
    // the total so the overview matches the sprint-detail issue count — users
    // were confused by the silent exclusion. Cancelled issues with a roadmap
    // link are skipped from the amber/green classification below so they do
    // not unfairly drag `roadmapOnTimeRate`; they always land in
    // `uncoveredIssues`.
    const filteredIssues = sprintIssues.filter((i) => isWorkItem(i.issueType));

    if (filteredIssues.length === 0) {
      return this.emptyAccuracy(sprint);
    }

    // Build epicKey → targetDate map scoped to the sprint window.
    // filterIdeasForWindow excludes ideas without both dates (decision 2)
    // and applies the date-window overlap filter. Conflict resolution
    // follows each roadmap's epicConflictResolution policy (proposal 0053).
    const sprintStart = sprint.startDate ?? new Date();
    const sprintEnd = sprint.endDate ?? new Date();
    const epicIdeaMap = this.filterIdeasForWindow(allIdeas, sprintStart, sprintEnd, ruleByJpdKey);

    // Query ALL done-status transitions for sprint issues — no date restriction
    // and no needsChangelogCheck split.  This ensures issues that were already
    // in Done status at sync time still get a reliable resolvedAt timestamp.
    const allFilteredKeys = filteredIssues.map((i) => i.key);
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allFilteredKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // completionDates: issueKey → first done-transition timestamp (all-time)
    const completionDates = new Map<string, Date>();
    for (const cl of changelogs) {
      if (cl.toValue !== null && doneStatusNames.includes(cl.toValue)) {
        if (!completionDates.has(cl.issueKey)) {
          completionDates.set(cl.issueKey, cl.changedAt);
        }
      }
    }

    // Direct-link coverage map (Condition C — ADR 0044):
    // When roadmapLinkTypes is non-empty, bulk-query jira_issue_links for
    // issues directly linked to a known JPD idea via a qualifying link type.
    const directLinkIdeaMap = await buildDirectLinkIdeaMap(
      this.issueLinkRepo,
      allFilteredKeys,
      allIdeas,
      roadmapLinkTypes,
      ruleByJpdKey,
    );

    // Per-issue delivery classification:
    //   in-scope (green)  = linked to an idea AND:
    //                         (a) resolvedAt <= idea.targetDate (end-of-day), OR
    //                         (b) in-flight in active sprint with targetDate not yet lapsed
    //   linked   (amber)  = linked to an idea AND neither (a) nor (b)
    //   none              = no roadmap link
    const coveredIssues: JiraIssue[] = [];
    const linkedNotCoveredIssues: JiraIssue[] = [];

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0); // start of today UTC

    for (const issue of filteredIssues) {
      // Cancelled issues stay in the total but never count as covered or
      // amber — they have no meaningful delivery signal.
      if (cancelledStatusNames.includes(issue.status)) continue;

      // Epic link takes priority; fall back to direct link (ADR 0044)
      const epicIdea = issue.epicKey ? epicIdeaMap.get(issue.epicKey) : undefined;
      const directIdea = directLinkIdeaMap.get(issue.key);
      const idea = epicIdea ?? directIdea;
      if (!idea) continue;

      const targetEndOfDay = this.endOfDayUTC(idea.targetDate);
      const resolvedAt = completionDates.get(issue.key) ?? null;

      // Condition A: delivered on time
      const deliveredOnTime = resolvedAt !== null && resolvedAt <= targetEndOfDay;

      // Condition B: in-flight and on track
      const isInFlight =
        sprint.state === 'active' &&
        idea.targetDate >= today &&
        !doneStatusNames.includes(issue.status) &&
        !cancelledStatusNames.includes(issue.status);

      if (deliveredOnTime || isInFlight) {
        coveredIssues.push(issue);
      } else {
        linkedNotCoveredIssues.push(issue);
      }
    }

    // Compute metrics
    const totalIssues = filteredIssues.length;
    const coveredCount = coveredIssues.length;
    const uncoveredIssues = totalIssues - coveredCount;
    const roadmapCoverage =
      totalIssues > 0
        ? Math.round((coveredCount / totalIssues) * 10000) / 100
        : 0;

    // roadmapOnTimeRate = green ÷ (green + amber)
    const totalLinkedIssues = coveredCount + linkedNotCoveredIssues.length;
    const roadmapOnTimeRate =
      totalLinkedIssues > 0
        ? Math.round((coveredCount / totalLinkedIssues) * 10000) / 100
        : 0;

    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      totalIssues,
      coveredIssues: coveredCount,
      uncoveredIssues,
      linkedCount: totalLinkedIssues,
      roadmapCoverage,
      roadmapOnTimeRate,
    };
  }

  private emptyAccuracy(sprint: JiraSprint): RoadmapSprintAccuracy {
    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      totalIssues: 0,
      coveredIssues: 0,
      uncoveredIssues: 0,
      linkedCount: 0,
      roadmapCoverage: 0,
      roadmapOnTimeRate: 0,
    };
  }

  /**
   * Extend a date to 23:59:59.999 UTC (end of calendar day).
   * Polaris stores targetDate as a date-only value (midnight UTC); this
   * ensures a completion timestamp at any point during the target day
   * is considered on-time.
   */
  private endOfDayUTC(date: Date): Date {
    const d = new Date(date.getTime());
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }

  private quarterToDates(quarter: string): { startDate: Date; endDate: Date } {
    const match = quarter.match(/^(\d{4})-Q([1-4])$/);
    if (!match) {
      throw new Error(`Invalid quarter format: ${quarter}. Expected YYYY-QN`);
    }
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    const year = parseInt(match[1], 10);
    const q = parseInt(match[2], 10);
    const startMonth = (q - 1) * 3; // 0-indexed
    const startDate = midnightInTz(year, startMonth, 1, tz);
    // Last day of the quarter: month startMonth+3 day 0 = last day of month startMonth+2
    const endDate = midnightInTz(year, startMonth + 3, 0, tz);
    endDate.setUTCHours(23, 59, 59, 999);
    return { startDate, endDate };
  }

  async getConfigs(): Promise<RoadmapConfig[]> {
    return this.roadmapConfigRepo.find({ order: { createdAt: 'ASC' } });
  }

  async createConfig(jpdKey: string, description?: string): Promise<RoadmapConfig> {
    const existing = await this.roadmapConfigRepo.findOne({ where: { jpdKey } });
    if (existing) {
      throw new ConflictException(
        `A roadmap config for JPD key "${jpdKey}" already exists`,
      );
    }
    const config = this.roadmapConfigRepo.create({
      jpdKey,
      description: description ?? null,
    });
    return this.roadmapConfigRepo.save(config);
  }

  async updateConfig(
    id: number,
    startDateFieldId?: string | null,
    targetDateFieldId?: string | null,
  ): Promise<RoadmapConfig> {
    const existing = await this.roadmapConfigRepo.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Roadmap config with id ${id} not found`);
    }
    if (startDateFieldId !== undefined) {
      existing.startDateFieldId = startDateFieldId;
    }
    if (targetDateFieldId !== undefined) {
      existing.targetDateFieldId = targetDateFieldId;
    }
    return this.roadmapConfigRepo.save(existing);
  }

  async deleteConfig(id: number): Promise<void> {
    const existing = await this.roadmapConfigRepo.findOne({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Roadmap config with id ${id} not found`);
    }
    await this.roadmapConfigRepo.delete({ id });
  }

  async syncRoadmaps(): Promise<{ message: string }> {
    await this.syncService.syncRoadmaps();
    return { message: 'Roadmap sync completed' };
  }

  private emptyAccuracyForSprints(sprints: JiraSprint[]): RoadmapSprintAccuracy[] {
    return sprints.map((s) => this.emptyAccuracy(s));
  }
}
