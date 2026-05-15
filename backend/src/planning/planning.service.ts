import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  BoardConfig,
} from '../database/entities/index.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { dateParts, midnightInTz } from '../metrics/tz-utils.js';
import { dateToIsoWeekKey, isoWeekKeyToDates } from '../lib/iso-week.js';
import {
  filterKanbanIssues,
  getKanbanCompletedThisWeek,
  getKanbanInFlight,
  buildKanbanBoardEntryDateMap,
  DEFAULT_BOARD_ENTRY_STATUSES,
} from '../lib/kanban-week-stats.js';
import {
  SprintMembershipService,
  SPRINT_GRACE_PERIOD_MS,
  summariseMembership,
} from '../sprint-membership/sprint-membership.service.js';

export interface SprintAccuracy {
  sprintId: string;
  sprintName: string;
  state: string;
  startDate: string | null;
  commitment: number;
  added: number;
  removed: number;
  completed: number;
  scopeChangePercent: number;
  completionRate: number;
  /** Planning accuracy: committed issues delivered / committed issues.
   *  Uses story points when available, falls back to ticket count.
   *  null when there are zero committed issues. */
  planningAccuracy: number | null;
  /** Sum of story points for committed issues. null signals ticket-count fallback. */
  committedPoints: number | null;
  /** Sum of story points completed from the committed set. null signals ticket-count fallback. */
  completedPoints: number | null;
}

export interface QuarterInfo {
  quarter: string;
  startDate: string;
  endDate: string;
}

export interface KanbanQuarterSummary {
  quarter: string;
  state: string; // 'active' | 'closed'
  issuesPulledIn: number;
  completed: number;
  addedMidQuarter: number;
  pointsIn: number;
  pointsDone: number;
  deliveryRate: number; // 0-100
}

export interface KanbanWeekSummary {
  week: string;           // "2026-W15"
  state: string;          // 'active' | 'closed'
  weekStart: string;      // ISO date string
  issuesPulledIn: number;
  completed: number;
  addedMidWeek: number;   // board entry date is > 1 day after week start
  inFlightCount: number;  // on-board issues not done/cancelled, entered before this week
  pointsIn: number;
  pointsDone: number;
  deliveryRate: number;   // 0-100
}

@Injectable()
export class PlanningService {
  private readonly logger = new Logger(PlanningService.name);

  constructor(
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    private readonly configService: ConfigService,
    private readonly sprintMembership: SprintMembershipService,
  ) {}

  async getAccuracy(
    boardId: string,
    sprintId?: string,
    quarter?: string,
  ): Promise<SprintAccuracy[]> {
    // Check for Kanban board
    const config = await this.boardConfigRepo.findOne({
      where: { boardId },
    });
    if (config?.boardType === 'kanban') {
      throw new BadRequestException(
        'Planning accuracy is not available for Kanban boards',
      );
    }

    // Build sprint list. Closed-sprint enumeration for carry-over detection
    // is now handled inside SprintMembershipService — this method only needs
    // to determine WHICH sprints to report on.
    let sprints: JiraSprint[];

    if (sprintId) {
      const sprint = await this.sprintRepo.findOne({
        where: { id: sprintId, boardId },
      });
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
      const closedSprints = await this.sprintRepo.find({
        where: { boardId, state: 'closed' },
        order: { startDate: 'DESC' },
      });
      const active = await this.sprintRepo.find({
        where: { boardId, state: 'active' },
        order: { startDate: 'DESC' },
      });
      sprints = [...active, ...closedSprints];
    }

    const results: SprintAccuracy[] = [];

    for (const sprint of sprints) {
      const accuracy = await this.calculateSprintAccuracy(sprint);
      results.push(accuracy);
    }

    return results;
  }

  private async calculateSprintAccuracy(
    sprint: JiraSprint,
  ): Promise<SprintAccuracy> {
    if (!sprint.startDate) {
      return this.emptyAccuracy(sprint);
    }

    // Get ALL board issues so the membership service can reconstruct.
    const boardIssues = (
      await this.issueRepo.find({ where: { boardId: sprint.boardId } })
    ).filter((i) => isWorkItem(i.issueType));

    if (boardIssues.length === 0) {
      return this.emptyAccuracy(sprint);
    }

    const issueStatusMap = new Map(boardIssues.map((i) => [i.key, i.status]));

    // Reconstruct sprint membership via the canonical service (ADR 0049).
    const membership = await this.sprintMembership.reconstruct({
      sprint,
      boardId: sprint.boardId,
      boardIssues,
    });

    const { committedKeys, addedKeys, currentMemberKeys } = membership;

    if (committedKeys.size === 0 && addedKeys.size === 0) {
      return this.emptyAccuracy(sprint);
    }

    // Determine completed issues
    const config = await this.boardConfigRepo.findOne({
      where: { boardId: sprint.boardId },
    });
    const doneStatuses = config?.doneStatusNames ?? [
      'Done',
      'Closed',
      'Released',
    ];

    // The actual final-sprint set is `currentMemberKeys` from the join table —
    // mathematically equivalent to (committed − committedRemoved) ∪ (added − addedRemoved)
    // and the source of truth for completion checks (proposal 0050 / ADR 0052).
    const finalSprintKeys = new Set(currentMemberKeys);

    const completedKeys = new Set<string>();

    if (finalSprintKeys.size > 0) {
      const finalKeys = [...finalSprintKeys];
      const statusChangelogs = await this.changelogRepo
        .createQueryBuilder('cl')
        .where('cl.issueKey IN (:...keys)', { keys: finalKeys })
        .andWhere('cl.field = :field', { field: 'status' })
        .orderBy('cl.changedAt', 'ASC')
        .getMany();

      const statusLogsByIssue = new Map<string, JiraChangelog[]>();
      for (const cl of statusChangelogs) {
        const list = statusLogsByIssue.get(cl.issueKey) ?? [];
        list.push(cl);
        statusLogsByIssue.set(cl.issueKey, list);
      }

      for (const key of finalKeys) {
        const logs = statusLogsByIssue.get(key) ?? [];
        if (sprint.endDate) {
          // Closed sprint: check changelog for a Done transition that occurred
          // INSIDE the sprint window (with the same SPRINT_GRACE_PERIOD_MS
          // tolerance the SprintMembershipService applies).
          //
          // D-2 (proposal 0055): without the lower bound, a carry-over issue
          // that completed in a *previous* sprint would be wrongly counted as
          // completed in this sprint whenever it was added back to the sprint
          // (e.g. for follow-up work) and the original Done transition still
          // pre-dated the sprint start.
          const lowerBound = sprint.startDate
            ? sprint.startDate.getTime() - SPRINT_GRACE_PERIOD_MS
            : Number.NEGATIVE_INFINITY;
          const upperBound = sprint.endDate.getTime() + SPRINT_GRACE_PERIOD_MS;
          const hasDoneTransition = logs.some(
            (cl) =>
              doneStatuses.includes(cl.toValue ?? '') &&
              cl.changedAt.getTime() >= lowerBound &&
              cl.changedAt.getTime() <= upperBound,
          );
          if (hasDoneTransition) {
            completedKeys.add(key);
          }
        } else {
          // Active sprint (no endDate): use current status as a proxy.
          const status = issueStatusMap.get(key);
          if (status && doneStatuses.includes(status)) {
            completedKeys.add(key);
          } else {
            const hasDoneTransition = logs.some((cl) =>
              doneStatuses.includes(cl.toValue ?? ''),
            );
            if (hasDoneTransition) {
              completedKeys.add(key);
            }
          }
        }
      }
    }

    const summary = summariseMembership(membership);
    const commitment = summary.commitmentCount;
    const added = summary.addedCount;       // gross
    const removed = summary.removedCount;   // committed-removed only
    const completed = completedKeys.size;
    const scopeChangePercent = summary.scopeChangePercent;
    // Divisor is the actual final-sprint set (per ADR 0052), not
    // `commitment + added - removed` which under-counts when add-then-remove
    // churn was double-subtracted under the old shape.
    const completionRate =
      currentMemberKeys.size > 0
        ? Math.round((completed / currentMemberKeys.size) * 10000) / 100
        : 0;

    // ---- Planning accuracy ------------------------------------------------
    const issuePointsMap = new Map<string, number | null>(
      boardIssues.map((i) => [i.key, i.points]),
    );

    let planningAccuracy: number | null = null;
    let committedPoints: number | null = null;
    let completedPoints: number | null = null;

    if (committedKeys.size > 0) {
      const committedArr = [...committedKeys];
      const allNull = committedArr.every(
        (k) =>
          issuePointsMap.get(k) === null ||
          issuePointsMap.get(k) === undefined,
      );

      if (!allNull) {
        const sumCommitted = committedArr.reduce(
          (acc, k) => acc + (issuePointsMap.get(k) ?? 0),
          0,
        );
        const sumCompleted = [...completedKeys]
          .filter((k) => committedKeys.has(k))
          .reduce((acc, k) => acc + (issuePointsMap.get(k) ?? 0), 0);

        committedPoints = sumCommitted;
        completedPoints = sumCompleted;
        planningAccuracy =
          sumCommitted > 0
            ? Math.round((sumCompleted / sumCommitted) * 10000) / 100
            : 0;
      } else {
        const completedFromCommitted = [...completedKeys].filter((k) =>
          committedKeys.has(k),
        ).length;
        planningAccuracy =
          Math.round(
            (completedFromCommitted / committedKeys.size) * 10000,
          ) / 100;
      }
    }

    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      commitment,
      added,
      removed,
      completed,
      scopeChangePercent,
      completionRate,
      planningAccuracy,
      committedPoints,
      completedPoints,
    };
  }

  private emptyAccuracy(sprint: JiraSprint): SprintAccuracy {
    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      commitment: 0,
      added: 0,
      removed: 0,
      completed: 0,
      scopeChangePercent: 0,
      completionRate: 0,
      planningAccuracy: null,
      committedPoints: null,
      completedPoints: null,
    };
  }

  async getSprints(
    boardId: string,
  ): Promise<{ id: string; name: string; state: string }[]> {
    const sprints = await this.sprintRepo.find({
      where: { boardId },
      order: { startDate: 'DESC' },
    });

    return sprints.map((s) => ({
      id: s.id,
      name: s.name,
      state: s.state,
    }));
  }

  async getQuarters(): Promise<QuarterInfo[]> {
    const sprints = await this.sprintRepo.find({
      where: { state: 'closed' },
      order: { startDate: 'ASC' },
    });

    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    const quarters = new Map<string, QuarterInfo>();

    for (const sprint of sprints) {
      if (!sprint.startDate) continue;
      const { year, month } = dateParts(sprint.startDate, tz);
      const q = Math.floor(month / 3) + 1;
      const key = `${year}-Q${q}`;

      if (!quarters.has(key)) {
        const startMonth = (q - 1) * 3;
        const startDate = midnightInTz(year, startMonth, 1, tz);
        const endDate = new Date(midnightInTz(year, startMonth + 3, 1, tz).getTime() - 1);
        quarters.set(key, {
          quarter: key,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });
      }
    }

    return [...quarters.values()].sort((a, b) =>
      b.quarter.localeCompare(a.quarter),
    );
  }

  async getKanbanQuarters(boardId: string): Promise<KanbanQuarterSummary[]> {
    // Verify this is actually a Kanban board
    const config = await this.boardConfigRepo.findOne({ where: { boardId } });
    if (!config || config.boardType !== 'kanban') {
      throw new BadRequestException(
        `Board ${boardId} is not a Kanban board`,
      );
    }

    const doneStatuses: string[] = config.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const backlogStatusIds: string[] = config.backlogStatusIds ?? [];

    // C-3: configurable board-entry status list (fix for hardcoded 'To Do').
    // An issue enters the board when it first transitions *to* one of these statuses.
    const boardEntryStatuses: string[] = config.boardEntryStatuses ?? [
      'To Do', 'Backlog', 'Open', 'New', 'TODO', 'OPEN', 'Selected for Development',
    ];

    // Load all issues for this board, excluding Epics and Sub-tasks
    const allIssues = (
      await this.issueRepo.find({ where: { boardId } })
    ).filter((i) => isWorkItem(i.issueType));

    if (allIssues.length === 0) {
      return [];
    }

    const issueKeys = allIssues.map((i) => i.key);

    // Bulk-load the earliest board-entry changelog per issue.
    // An issue "enters" the board on the first transition *to* a boardEntryStatus.
    const boardEntryChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .andWhere('cl.toValue IN (:...statuses)', { statuses: boardEntryStatuses })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // issueKey -> earliest date it left "To Do"
    const boardEntryDate = new Map<string, Date>();
    for (const cl of boardEntryChangelogs) {
      if (!boardEntryDate.has(cl.issueKey)) {
        boardEntryDate.set(cl.issueKey, cl.changedAt);
      }
    }

    // Bulk-load the set of issue keys that have ANY status changelog
    // (used as fallback when backlogStatusIds is not configured)
    const issueKeysWithChangelog = new Set<string>(
      boardEntryChangelogs.map((cl) => cl.issueKey),
    );
    // Also catch issues that moved between non-"To Do" statuses
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

    // Exclude pure-backlog issues: those that have never been pulled onto the board.
    // Primary: statusId is in backlogStatusIds (precise, requires post-sync data).
    // Fallback: issue has no status changelog at all (heuristic for pre-migration data).
    const onBoardIssues = allIssues.filter((issue) => {
      if (backlogStatusIds.length > 0) {
        // If statusId is known and matches a backlog status, exclude it.
        // If statusId is null (pre-migration), fall back to changelog heuristic.
        if (issue.statusId !== null) {
          return !backlogStatusIds.includes(issue.statusId);
        }
      }
      // Fallback: only include issues that have moved at least once
      return issueKeysWithChangelog.has(issue.key);
    });

    if (onBoardIssues.length === 0) {
      return [];
    }

    // Apply dataStartDate lower bound filter if configured
    const dataStartDate = config.dataStartDate ?? null;
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

    // Build map: issueKey → first done-transition timestamp (changelog-based)
    const allBoundedKeys = boundedIssues.map((i) => i.key);
    const doneChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allBoundedKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .andWhere('cl.toValue IN (:...statuses)', { statuses: doneStatuses })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    const completionDateByIssue = new Map<string, Date>();
    for (const cl of doneChangelogs) {
      if (!completionDateByIssue.has(cl.issueKey)) {
        completionDateByIssue.set(cl.issueKey, cl.changedAt);
      }
    }

    // Bucket issues by the quarter of their board-entry date (fall back to createdAt)
    const quarterMap = new Map<string, typeof onBoardIssues>();
    for (const issue of boundedIssues) {
      const entryDate = boardEntryDate.get(issue.key) ?? issue.createdAt;
      const key = this.dateToQuarterKey(entryDate);
      const list = quarterMap.get(key) ?? [];
      list.push(issue);
      quarterMap.set(key, list);
    }

    const now = new Date();
    const currentQuarterKey = this.dateToQuarterKey(now);

    // For each quarter, derive per-issue "completed" and "addedMidQuarter" flags.
    // "addedMidQuarter" = board-entry date is after the 14-day grace period from quarter start.
    const results: KanbanQuarterSummary[] = [];

    const sortedKeys = Array.from(quarterMap.keys()).sort((a, b) =>
      b.localeCompare(a),
    );

    for (const qKey of sortedKeys) {
      const issues = quarterMap.get(qKey)!;
      const { startDate, endDate } = this.quarterToDates(qKey);
      const gracePeriodEnd = new Date(
        startDate.getTime() + 14 * 24 * 60 * 60 * 1000,
      );
      const state = qKey === currentQuarterKey ? 'active' : 'closed';

      let completed = 0;
      let addedMidQuarter = 0;
      let pointsIn = 0;
      let pointsDone = 0;

      for (const issue of issues) {
        const pts = issue.points ?? 0;
        pointsIn += pts;

        // Use changelog-based completion date — avoids stale current-status snapshot
        const completedAt = completionDateByIssue.get(issue.key);
        const isCompleted =
          completedAt !== undefined &&
          completedAt >= startDate &&
          completedAt <= endDate;
        if (isCompleted) {
          completed++;
          pointsDone += pts;
        }

        const entryDate = boardEntryDate.get(issue.key) ?? issue.createdAt;
        if (entryDate > gracePeriodEnd) {
          addedMidQuarter++;
        }
      }

      const issuesPulledIn = issues.length;
      const deliveryRate =
        issuesPulledIn > 0
          ? Math.round((completed / issuesPulledIn) * 10000) / 100
          : 0;

      results.push({
        quarter: qKey,
        state,
        issuesPulledIn,
        completed,
        addedMidQuarter,
        pointsIn,
        pointsDone,
        deliveryRate,
      });
    }

    return results;
  }

  async getKanbanWeeks(boardId: string): Promise<KanbanWeekSummary[]> {
    // Verify this is actually a Kanban board
    const config = await this.boardConfigRepo.findOne({ where: { boardId } });
    if (!config || config.boardType !== 'kanban') {
      throw new BadRequestException(
        `Board ${boardId} is not a Kanban board`,
      );
    }

    const doneStatuses: string[] = config.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const doneStatusesSet = new Set(doneStatuses.map((s) => s.toLowerCase()));
    const cancelledStatusesSet = new Set(
      (config.cancelledStatusNames ?? ['Cancelled', "Won't Do"]).map((s) => s.toLowerCase()),
    );
    const backlogStatusIds: string[] = config.backlogStatusIds ?? [];

    // Shared board-entry status list (proposal 0066).
    const boardEntryStatuses: string[] = config.boardEntryStatuses ?? [...DEFAULT_BOARD_ENTRY_STATUSES];
    const boardEntryStatusSet = new Set(boardEntryStatuses.map((s) => s.toLowerCase()));

    // Load all issues for this board, excluding Epics and Sub-tasks
    const allIssues = (
      await this.issueRepo.find({ where: { boardId } })
    ).filter((i) => isWorkItem(i.issueType));

    if (allIssues.length === 0) {
      return [];
    }

    const issueKeys = allIssues.map((i) => i.key);

    // Bulk-load ALL status changelogs for board issues (needed for both
    // board-entry detection and board-wide completion scanning).
    const allStatusChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Group by issueKey for the shared helpers
    const changelogsByIssue = new Map<string, typeof allStatusChangelogs>();
    const issueKeysWithStatusChangelog = new Set<string>();
    for (const cl of allStatusChangelogs) {
      const list = changelogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      changelogsByIssue.set(cl.issueKey, list);
      issueKeysWithStatusChangelog.add(cl.issueKey);
    }

    // Board-entry date per issue using the shared helper
    const boardEntryDateByKey = buildKanbanBoardEntryDateMap(
      allIssues,
      changelogsByIssue,
      boardEntryStatusSet,
    );

    // Apply inBacklog + dataStartDate filters using the shared helper (ADR 0067)
    const dataStartBound = config.dataStartDate ? new Date(config.dataStartDate) : null;
    const boundedIssuesWeeks = filterKanbanIssues({
      issues: allIssues,
      dataStartBound,
      boardEntryDateByKey,
    });

    if (boundedIssuesWeeks.length === 0) {
      return [];
    }

    // Bucket issues by the week of their board-entry date (fall back to createdAt)
    const weekMap = new Map<string, typeof boundedIssuesWeeks>();
    for (const issue of boundedIssuesWeeks) {
      const entryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;
      const key = this.dateToWeekKey(entryDate);
      const list = weekMap.get(key) ?? [];
      list.push(issue);
      weekMap.set(key, list);
    }

    const now = new Date();
    const currentWeekKey = this.dateToWeekKey(now);
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');

    const results: KanbanWeekSummary[] = [];

    const sortedKeys = Array.from(weekMap.keys()).sort((a, b) =>
      b.localeCompare(a),
    );

    for (const wKey of sortedKeys) {
      const issues = weekMap.get(wKey)!;
      const { weekStart, weekEnd } = isoWeekKeyToDates(wKey, tz);
      const state = wKey === currentWeekKey ? 'active' : 'closed';

      // issuesPulledIn = issues that entered the board this week
      const issuesPulledIn = issues.length;
      const pointsIn = issues.reduce((s, i) => s + (i.points ?? 0), 0);

      // completed = ALL filtered board issues with a done-transition this week
      // (board-wide throughput — not cohort — proposal 0066 / ADR 0063).
      const completedIssues = getKanbanCompletedThisWeek(
        boundedIssuesWeeks,
        changelogsByIssue,
        doneStatusesSet,
        weekStart,
        weekEnd,
      );
      const completed = completedIssues.length;
      const pointsDone = completedIssues.reduce((s, i) => s + (i.points ?? 0), 0);

      // addedMidWeek: issues that entered after the 1-day grace period (Monday).
      const gracePeriodEnd = new Date(weekStart.getTime() + 1 * 24 * 60 * 60 * 1000);
      const addedMidWeek = issues.filter((issue) => {
        const entryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;
        return entryDate > gracePeriodEnd;
      }).length;

      // inFlight: on-board issues not done/cancelled, entered before this week
      const inFlightCount = getKanbanInFlight(
        boundedIssuesWeeks,
        doneStatusesSet,
        cancelledStatusesSet,
        boardEntryDateByKey,
        weekStart,
        weekEnd,
      ).length;

      const deliveryRate =
        issuesPulledIn > 0
          ? Math.round((completed / issuesPulledIn) * 10000) / 100
          : 0;

      results.push({
        week: wKey,
        state,
        weekStart: weekStart.toISOString(),
        issuesPulledIn,
        completed,
        addedMidWeek,
        inFlightCount,
        pointsIn,
        pointsDone,
        deliveryRate,
      });
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Quarter helpers
  // ---------------------------------------------------------------------------

  private dateToQuarterKey(date: Date): string {
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    const { year, month } = dateParts(date, tz);
    const q = Math.floor(month / 3) + 1;
    return `${year}-Q${q}`;
  }

  private quarterToDates(quarter: string): {
    startDate: Date;
    endDate: Date;
  } {
    const match = quarter.match(/^(\d{4})-Q([1-4])$/);
    if (!match) {
      throw new BadRequestException(
        `Invalid quarter format: ${quarter}. Expected YYYY-QN`,
      );
    }
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    const year = parseInt(match[1], 10);
    const q = parseInt(match[2], 10);
    const startMonth = (q - 1) * 3; // 0-indexed
    const startDate = midnightInTz(year, startMonth, 1, tz);
    const endDate = midnightInTz(year, startMonth + 3, 0, tz);
    endDate.setUTCHours(23, 59, 59, 999);
    return { startDate, endDate };
  }

  // ---------------------------------------------------------------------------
  // ISO week helpers
  // ---------------------------------------------------------------------------

  private dateToWeekKey(date: Date): string {
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');
    return dateToIsoWeekKey(date, tz);
  }

}
