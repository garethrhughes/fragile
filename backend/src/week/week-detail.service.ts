import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BoardConfig,
  JiraChangelog,
  JiraIssue,
  JiraIssueLink,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { buildDirectLinkIdeaMap } from '../metrics/roadmap-link-utils.js';
import { dateParts, startOfDayInTz } from '../metrics/tz-utils.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';
import { extractCycles, resolveResetNames } from '../metrics/cycle.js';

// ---------------------------------------------------------------------------
// Response interfaces (exported for use by the controller and frontend types)
// ---------------------------------------------------------------------------

export interface WeekDetailIssue {
  /** Jira issue key, e.g. "ACC-123" */
  key: string;

  /** Issue summary / title */
  summary: string;

  /** Jira issue type, e.g. "Story", "Bug", "Task" */
  issueType: string;

  /** Issue priority, or null if not set */
  priority: string | null;

  /** Current status at time of last sync */
  status: string;

  /** Story points, or null if not set */
  points: number | null;

  /** Epic key, or null if not set */
  epicKey: string | null;

  /** The week this issue was assigned to, e.g. "2026-W15" */
  assignedWeek: string;

  /** True if the issue transitioned to a done status within the week window */
  completedInWeek: boolean;

  /** True if the issue's board-entry date is > 1 day after week start */
  addedMidWeek: boolean;

  /**
   * Roadmap delivery status:
   *   in-scope = linked to idea AND (delivered on or before targetDate [Condition A]
   *              OR in-flight on an active week with target not yet passed [Condition B])
   *   linked   = linked to idea AND not in-scope
   *   none     = no roadmap link, or issue is cancelled
   */
  roadmapStatus: 'in-scope' | 'linked' | 'none';

  /** How the roadmap link was established: 'direct' (Condition C) | 'epic' (A/B) | null */
  roadmapLinkSource: 'direct' | 'epic' | null;

  /** True if the issue matches incidentIssueTypes OR incidentLabels */
  isIncident: boolean;

  /** True if the issue matches failureIssueTypes OR failureLabels */
  isFailure: boolean;

  /** Labels attached to the issue */
  labels: string[];

  /** ISO 8601 timestamp of when the issue entered the board */
  boardEntryDate: string;

  /**
   * Cycle time in working days (latest completed cycle in the week, per
   * proposal 0054), or null if no representative cycle exists.
   */
  cycleTimeDays: number | null;

  /**
   * True when the representative cycle is a reopen (proposal 0054 AC C).
   */
  isReopen: boolean;

  /** Deep link to the issue in Jira Cloud, or empty string if not configured */
  jiraUrl: string;
}

export interface WeekDetailSummary {
  totalIssues: number;
  completedIssues: number;
  addedMidWeek: number;
  roadmapLinkedCount: number;
  incidentCount: number;
  failureCount: number;
  totalPoints: number;
  completedPoints: number;
  medianCycleTimeDays: number | null;
  /** Issues whose representative cycle is a reopen (proposal 0054 AC C). */
  reopenedIssueCount: number;
}

export interface WeekDetailBoardConfig {
  boardType: string;
  doneStatusNames: string[];
}

export interface WeekDetailResponse {
  boardId: string;
  week: string;
  weekStart: string;
  weekEnd: string;
  summary: WeekDetailSummary;
  issues: WeekDetailIssue[];
  boardConfig: WeekDetailBoardConfig;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class WeekDetailService {
  private readonly logger = new Logger(WeekDetailService.name);
  private readonly jiraBaseUrl: string;

  constructor(
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    @InjectRepository(RoadmapConfig)
    private readonly roadmapConfigRepo: Repository<RoadmapConfig>,
    @InjectRepository(JpdIdea)
    private readonly jpdIdeaRepo: Repository<JpdIdea>,
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
    private readonly configService: ConfigService,
    private readonly workingTimeService: WorkingTimeService,
  ) {
    const baseUrl = this.configService.get<string>('JIRA_BASE_URL', '');
    if (!baseUrl) {
      this.logger.warn(
        'JIRA_BASE_URL is not configured — jiraUrl fields will be empty strings',
      );
    }
    this.jiraBaseUrl = baseUrl;
  }

  async getDetail(
    boardId: string,
    week: string,
  ): Promise<WeekDetailResponse> {
    // -----------------------------------------------------------------------
    // Step 1 — Parse week to date range
    // -----------------------------------------------------------------------
    const { weekStart, weekEnd } = this.parseWeek(week);

    // -----------------------------------------------------------------------
    // Step 2 — Load board config
    // -----------------------------------------------------------------------
    const boardConfig = await this.boardConfigRepo.findOne({ where: { boardId } });
    const boardType: string = boardConfig?.boardType ?? 'scrum';

    // Week detail is only available for Kanban boards
    if (boardType !== 'kanban') {
      throw new BadRequestException(
        'Week detail is only available for Kanban boards',
      );
    }

    const doneStatuses: string[] = boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const cancelledStatusNames: string[] = boardConfig?.cancelledStatusNames ?? ['Cancelled', "Won't Do"];
    const inProgressStatusNames: string[] = boardConfig?.inProgressStatusNames ?? ['In Progress'];
    const incidentIssueTypes: string[] = boardConfig?.incidentIssueTypes ?? ['Bug', 'Incident'];
    const incidentLabels: string[] = boardConfig?.incidentLabels ?? [];
    const incidentPriorities: string[] = boardConfig?.incidentPriorities ?? ['Critical'];
    const failureIssueTypes: string[] = boardConfig?.failureIssueTypes ?? ['Bug', 'Incident'];
    const failureLabels: string[] = boardConfig?.failureLabels ?? ['regression', 'incident', 'hotfix'];
    const failureLinkTypes: string[] = boardConfig?.failureLinkTypes ?? [];
    const backlogStatusIds: string[] = boardConfig?.backlogStatusIds ?? [];
    const roadmapLinkTypes: string[] = boardConfig?.roadmapLinkTypes ?? [];

    // -----------------------------------------------------------------------
    // Step 3 — Load all issues for board
    // -----------------------------------------------------------------------
    const issues = (await this.issueRepo.find({ where: { boardId } }))
      .filter((i) => isWorkItem(i.issueType));

    if (issues.length === 0) {
      return this.buildEmptyResponse(boardId, week, weekStart, weekEnd, boardType, doneStatuses);
    }

    const allKeys = issues.map((i) => i.key);

    // -----------------------------------------------------------------------
    // Step 4 — Load all changelogs for those issues
    //
    // B-2 (proposal 0055): restrict to status + Sprint fields. We never read
    // any other field downstream, and unfiltered loads were pulling in
    // assignee/summary/labels/etc. for huge issue sets.
    // -----------------------------------------------------------------------
    const allChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allKeys })
      .andWhere('cl.field IN (:...fields)', { fields: ['status', 'Sprint'] })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Group changelogs by issueKey
    const changelogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of allChangelogs) {
      const list = changelogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      changelogsByIssue.set(cl.issueKey, list);
    }

    // Build set of issue keys that have any status changelog (backlog fallback)
    const issueKeysWithStatusChangelog = new Set<string>();
    for (const cl of allChangelogs) {
      if (cl.field === 'status') issueKeysWithStatusChangelog.add(cl.issueKey);
    }

    // -----------------------------------------------------------------------
    // Step 5 — Compute board-entry date per issue and exclude backlog items
    //
    // Board-entry date = the earliest changelog where toValue is in the
    // configured boardEntryStatuses list (first transition *into* a board-
    // entry/staging status).  This matches the algorithm used by the planning
    // overview (getKanbanWeeks) so both views agree on which week an issue
    // entered the board.
    //
    // Previous implementation used fromValue === 'To Do' (first transition
    // *out of* To Do).  That direction is wrong and hard-coded to a single
    // status — it caused "1 ticket in overview, 0 in detail" divergence for
    // issues that entered via Backlog, Open, or any other configured entry
    // status.
    // -----------------------------------------------------------------------
    const boardEntryStatuses: string[] = boardConfig?.boardEntryStatuses ?? [
      'To Do', 'Backlog', 'Open', 'New', 'TODO', 'OPEN', 'Selected for Development',
    ];

    const boardEntryDateByKey = new Map<string, Date>();

    for (const issue of issues) {
      const issueChangelogs = changelogsByIssue.get(issue.key) ?? [];

      const entryTransition = issueChangelogs.find(
        (cl) =>
          cl.field === 'status' &&
          cl.toValue !== null &&
          boardEntryStatuses.map((s) => s.toLowerCase()).includes(cl.toValue.toLowerCase()),
      );
      const entryDate = entryTransition ? entryTransition.changedAt : issue.createdAt;

      boardEntryDateByKey.set(issue.key, entryDate);
    }

    // Exclude pure-backlog issues (never pulled onto the board).
    // Primary: statusId is in backlogStatusIds. Fallback: no status changelog at all.
    const filteredIssues = issues.filter((issue) => {
      if (backlogStatusIds.length > 0 && issue.statusId !== null) {
        return !backlogStatusIds.includes(issue.statusId);
      }
      return issueKeysWithStatusChangelog.has(issue.key);
    });

    // Apply dataStartDate lower bound filter (before the week window filter)
    const dataStartDate = boardConfig?.dataStartDate ?? null;
    const startBound = dataStartDate ? new Date(dataStartDate) : null;
    const startBoundedIssues = startBound
      ? filteredIssues.filter((issue) => {
          const entryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;
          return entryDate >= startBound;
        })
      : filteredIssues;

    // -----------------------------------------------------------------------
    // Step 6 — Filter issues to those whose boardEntryDate falls within the week
    // -----------------------------------------------------------------------
    const weekIssues = startBoundedIssues.filter((issue) => {
      const entryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;
      return entryDate >= weekStart && entryDate <= weekEnd;
    });

    if (weekIssues.length === 0) {
      return this.buildEmptyResponse(boardId, week, weekStart, weekEnd, boardType, doneStatuses);
    }

    // -----------------------------------------------------------------------
    // Step 6b — failureLinkTypes AND-gate: bulk causal-link query
    //
    // When failureLinkTypes is non-empty, only issues with a matching causal
    // link (e.g. 'caused by') are classified as failures.  When
    // failureLinkTypes is empty (the default), all type/label matches qualify.
    // See Proposal 0032.
    // -----------------------------------------------------------------------
    const weekIssueKeys = weekIssues.map((i) => i.key);
    let keysWithCausalLink = new Set<string>();
    if (failureLinkTypes.length > 0) {
      const linkRows = await this.issueLinkRepo
        .createQueryBuilder('l')
        .select('l.sourceIssueKey', 'key')
        .where('l.sourceIssueKey IN (:...keys)', { keys: weekIssueKeys })
        .andWhere('LOWER(l.linkTypeName) IN (:...types)', {
          types: failureLinkTypes.map((t) => t.toLowerCase()),
        })
        .getRawMany<{ key: string }>();
      keysWithCausalLink = new Set(linkRows.map((r) => r.key));
    }

    // -----------------------------------------------------------------------
    // Step 7 — Load RoadmapConfig, build allIdeas for roadmap linking
    // -----------------------------------------------------------------------
    const roadmapConfigs = await this.roadmapConfigRepo.find({ where: {} });
    let allIdeas: JpdIdea[] = [];

    if (roadmapConfigs.length > 0) {
      const jpdKeys = roadmapConfigs.map((r) => r.jpdKey);
      allIdeas = await this.jpdIdeaRepo.find({ where: { jpdKey: In(jpdKeys) } });
    }

    // Direct issue → idea links (ADR 0044 Condition C), using the same
    // roadmapLinkTypes as the roadmap service for consistent coverage.
    const directLinkIdeaMap = await buildDirectLinkIdeaMap(
      this.issueLinkRepo,
      weekIssueKeys,
      allIdeas,
      roadmapLinkTypes,
    );

    // Epic → idea map (Condition A — epic key covered by a roadmap idea)
    const epicIdeaMap = new Map<string, JpdIdea>();
    for (const idea of allIdeas) {
      for (const key of (idea.deliveryIssueKeys ?? [])) {
        if (key) epicIdeaMap.set(key, idea);
      }
    }

    // Working-time config for cycle time calculation
    const wtEntity = await this.workingTimeService.getConfig();
    const wtConfig = this.workingTimeService.toConfig(wtEntity);

    // Cycle helper inputs (proposal 0054). Lower-cased for tolerant matching
    // (week-detail historically does case-insensitive comparison on status names).
    const inProgressSet = new Set(inProgressStatusNames.map((s) => s.toLowerCase()));
    const doneSet = new Set(doneStatuses.map((s) => s.toLowerCase()));
    const resetSet = new Set(
      resolveResetNames(boardConfig?.boardEntryStatuses ?? null).map((s) =>
        s.toLowerCase(),
      ),
    );

    // 1-day grace period for addedMidWeek
    const gracePeriodEnd = new Date(weekStart.getTime() + 1 * 24 * 60 * 60 * 1000);

    // -----------------------------------------------------------------------
    // Step 8 — Build per-issue result
    // -----------------------------------------------------------------------
    const results: WeekDetailIssue[] = [];

    for (const issue of weekIssues) {
      const issueChangelogs = changelogsByIssue.get(issue.key) ?? [];
      const boardEntryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;

      // completedInWeek: has a status transition to a done status within the week window
      const completedInWeek = issueChangelogs.some(
        (cl) =>
          cl.field === 'status' &&
          cl.toValue !== null &&
          doneStatuses.includes(cl.toValue) &&
          cl.changedAt >= weekStart &&
          cl.changedAt <= weekEnd,
      );

      // addedMidWeek: boardEntryDate is > 1 day after week start
      const addedMidWeek = boardEntryDate > gracePeriodEnd;

      // roadmapStatus — mirrors sprint Condition A + B logic
      //   in-scope = linked AND (delivered on or before targetDate [A]
      //              OR in-flight on an active week with target not yet passed [B])
      //   linked   = linked AND not in-scope
      //   none     = no link, or cancelled
      let roadmapStatus: 'in-scope' | 'linked' | 'none' = 'none';
      let roadmapLinkSource: 'direct' | 'epic' | null = null;

      if (!cancelledStatusNames.includes(issue.status)) {
        const epicIdea = issue.epicKey !== null ? epicIdeaMap.get(issue.epicKey) : undefined;
        const directIdea = directLinkIdeaMap.get(issue.key);
        // Epic link takes priority (ADR 0044)
        const idea = epicIdea ?? directIdea;
        if (idea) {
          roadmapLinkSource = epicIdea ? 'epic' : 'direct';
          if (idea.targetDate !== null) {
            const targetEndOfDay = new Date(idea.targetDate.getTime());
            targetEndOfDay.setUTCHours(23, 59, 59, 999);
            const doneTransition = issueChangelogs.find(
              (cl) =>
                cl.field === 'status' &&
                cl.toValue !== null &&
                doneStatuses.includes(cl.toValue),
            );
            const resolvedDate = doneTransition?.changedAt ?? null;
            // Condition A: delivered on time
            const deliveredOnTime = resolvedDate !== null && resolvedDate <= targetEndOfDay;
            // Condition B: in-flight on an active week with target not yet passed.
            // Week is active when today is before weekEnd.
            const today = new Date();
            const isInFlight =
              today <= weekEnd &&
              idea.targetDate >= today &&
              resolvedDate === null &&
              !cancelledStatusNames.includes(issue.status);
            roadmapStatus = (deliveredOnTime || isInFlight) ? 'in-scope' : 'linked';
          } else {
            roadmapStatus = 'linked';
          }
        }
      }

      // cycleTimeDays: latest completed cycle (proposal 0054). Working-days
      // duration when excludeWeekends is enabled.
      let cycleTimeDays: number | null = null;
      let isReopen = false;

      // Normalise toValue to lowercase so the helper's Set.has matches our
      // lowercased status sets above.
      const normalisedLogs = issueChangelogs
        .filter((cl) => cl.field === 'status' && cl.toValue !== null)
        .map((cl) => ({ ...cl, toValue: cl.toValue!.toLowerCase() }));

      const issueCycles = extractCycles(
        normalisedLogs,
        inProgressSet,
        doneSet,
        resetSet,
      );
      if (issueCycles && issueCycles.cycles.length > 0) {
        // Representative cycle = latest cycle in the issue's history (matches
        // CycleTimeService semantics). Week-detail does not gate by window
        // because the issue is already filtered to the week.
        const rep = issueCycles.cycles[issueCycles.cycles.length - 1];
        const rawDays = wtEntity.excludeWeekends
          ? this.workingTimeService.workingDaysBetween(rep.start, rep.end, wtConfig)
          : (rep.end.getTime() - rep.start.getTime()) / 86_400_000;
        cycleTimeDays = rawDays >= 0 ? Math.round(rawDays * 100) / 100 : null;
        isReopen = rep.isReopen;
      }

      // isIncident: must match type/label AND pass priority AND-gate
      // (consistent with MttrService; incidentPriorities = [] means all priorities qualify)
      const matchesIncidentTypeOrLabel =
        incidentIssueTypes.includes(issue.issueType) ||
        (incidentLabels.length > 0 && issue.labels.some((l) => incidentLabels.includes(l)));
      const isIncident =
        matchesIncidentTypeOrLabel &&
        (incidentPriorities.length === 0 ||
          incidentPriorities.includes(issue.priority ?? ''));

      // isFailure: must pass type/label gate AND (if failureLinkTypes configured)
      // the causal-link AND-gate.  See Proposal 0032.
      const passesTypeGate =
        failureIssueTypes.includes(issue.issueType) ||
        (failureLabels.length > 0 && issue.labels.some((l) => failureLabels.includes(l)));
      const passesLinkGate =
        failureLinkTypes.length === 0 || keysWithCausalLink.has(issue.key);
      const isFailure = passesTypeGate && passesLinkGate;

      // jiraUrl
      const jiraUrl = this.jiraBaseUrl
        ? `${this.jiraBaseUrl}/browse/${issue.key}`
        : '';

      results.push({
        key: issue.key,
        summary: issue.summary,
        issueType: issue.issueType,
        priority: issue.priority,
        status: issue.status,
        points: issue.points,
        epicKey: issue.epicKey,
        assignedWeek: week,
        completedInWeek,
        addedMidWeek,
        roadmapStatus,
        roadmapLinkSource,
        isIncident,
        isFailure,
        labels: issue.labels,
        boardEntryDate: boardEntryDate.toISOString(),
        cycleTimeDays,
        isReopen,
        jiraUrl,
      });
    }

    // Sort: incomplete issues first (alphabetical by key), then completed
    results.sort((a, b) => {
      if (a.completedInWeek !== b.completedInWeek) {
        return a.completedInWeek ? 1 : -1;
      }
      return a.key.localeCompare(b.key);
    });

    // -----------------------------------------------------------------------
    // Step 9 — Build summary
    // -----------------------------------------------------------------------
    // Only sample issues that were completed within the week window so the
    // median reflects "cycle time for work delivered this week" (not all
    // issues whose changelogs happen to be loaded).
    const cycleSamples = results
      .filter((r) => r.completedInWeek && r.cycleTimeDays !== null)
      .map((r) => r.cycleTimeDays as number)
      .sort((a, b) => a - b);

    const medianCycleTimeDays =
      cycleSamples.length > 0 ? median(cycleSamples) : null;

    const summary: WeekDetailSummary = {
      totalIssues: weekIssues.length,
      completedIssues: results.filter((r) => r.completedInWeek).length,
      addedMidWeek: results.filter((r) => r.addedMidWeek).length,
      roadmapLinkedCount: results.filter((r) => r.roadmapStatus !== 'none').length,
      incidentCount: results.filter((r) => r.isIncident).length,
      failureCount: results.filter((r) => r.isFailure).length,
      totalPoints: results.reduce((s, r) => s + (r.points ?? 0), 0),
      completedPoints: results
        .filter((r) => r.completedInWeek)
        .reduce((s, r) => s + (r.points ?? 0), 0),
      medianCycleTimeDays,
      reopenedIssueCount: results.filter((r) => r.isReopen).length,
    };

    // -----------------------------------------------------------------------
    // Step 10 — Return response
    // -----------------------------------------------------------------------
    return {
      boardId,
      week,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      summary,
      issues: results,
      boardConfig: {
        boardType,
        doneStatusNames: doneStatuses,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private parseWeek(week: string): { weekStart: Date; weekEnd: Date } {
    const match = week.match(/^(\d{4})-W(\d{2})$/);
    if (!match) {
      throw new BadRequestException(
        `Invalid week format: "${week}". Expected YYYY-Www e.g. 2026-W15`,
      );
    }

    const year = parseInt(match[1], 10);
    const weekNum = parseInt(match[2], 10);
    const tz = this.configService.get<string>('TIMEZONE', 'UTC');

    // Jan 4 is always in ISO week 1 — find Monday of week 1 in the configured timezone.
    // We work in calendar-date space (not UTC) so that week boundaries align with
    // local midnight, matching the bucketing logic in PlanningService.dateToWeekKey.
    const jan4LocalParts = dateParts(new Date(Date.UTC(year, 0, 4)), tz);
    const jan4LocalDate = new Date(Date.UTC(jan4LocalParts.year, jan4LocalParts.month, jan4LocalParts.day));
    const jan4Dow = jan4LocalDate.getUTCDay(); // 0=Sun
    const daysToMon = jan4Dow === 0 ? -6 : 1 - jan4Dow;
    const week1MondayLocal = new Date(jan4LocalDate);
    week1MondayLocal.setUTCDate(jan4LocalDate.getUTCDate() + daysToMon);

    // Monday of the requested week (calendar date arithmetic)
    const weekMondayLocal = new Date(week1MondayLocal);
    weekMondayLocal.setUTCDate(week1MondayLocal.getUTCDate() + (weekNum - 1) * 7);

    // Sunday of the requested week (calendar date, 6 days after Monday)
    const weekSundayLocal = new Date(weekMondayLocal);
    weekSundayLocal.setUTCDate(weekMondayLocal.getUTCDate() + 6);

    // Convert calendar dates to UTC instants using the configured timezone.
    const weekStart = startOfDayInTz(
      weekMondayLocal.getUTCFullYear(),
      weekMondayLocal.getUTCMonth(),
      weekMondayLocal.getUTCDate(),
      tz,
    );
    // weekEnd = start of the day AFTER Sunday, minus 1ms
    const dayAfterWeekEnd = startOfDayInTz(
      weekSundayLocal.getUTCFullYear(),
      weekSundayLocal.getUTCMonth(),
      weekSundayLocal.getUTCDate() + 1,
      tz,
    );
    const weekEnd = new Date(dayAfterWeekEnd.getTime() - 1);

    return { weekStart, weekEnd };
  }

  private buildEmptyResponse(
    boardId: string,
    week: string,
    weekStart: Date,
    weekEnd: Date,
    boardType: string,
    doneStatusNames: string[],
  ): WeekDetailResponse {
    return {
      boardId,
      week,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      summary: {
        totalIssues: 0,
        completedIssues: 0,
        addedMidWeek: 0,
        roadmapLinkedCount: 0,
        incidentCount: 0,
        failureCount: 0,
        totalPoints: 0,
        completedPoints: 0,
        medianCycleTimeDays: null,
        reopenedIssueCount: 0,
      },
      issues: [],
      boardConfig: {
        boardType,
        doneStatusNames,
      },
    };
  }
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
