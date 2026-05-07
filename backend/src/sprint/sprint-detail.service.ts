import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  BoardConfig,
  JiraChangelog,
  JiraIssue,
  JiraIssueLink,
  JiraSprint,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';
import { buildDirectLinkIdeaMap } from '../metrics/roadmap-link-utils.js';
import {
  SprintMembershipService,
  summariseMembership,
} from '../sprint-membership/sprint-membership.service.js';
import { DEFAULT_IN_PROGRESS_NAMES } from '../metrics/status-defaults.js';

// ---------------------------------------------------------------------------
// Response interfaces (exported for use by the controller and frontend types)
// ---------------------------------------------------------------------------

/** Board configuration rules applied to derive per-issue annotations */
export interface SprintDetailBoardConfig {
  doneStatusNames: string[];
  failureIssueTypes: string[];
  failureLabels: string[];
  failureLinkTypes: string[];
  incidentIssueTypes: string[];
  incidentLabels: string[];
}

export interface SprintDetailIssue {
  /** Jira issue key, e.g. "ACC-123" */
  key: string;

  /** Issue summary / title */
  summary: string;

  /** Current status at time of last sync */
  currentStatus: string;

  /** Jira issue type, e.g. "Story", "Bug", "Task" */
  issueType: string;

  /** Jira priority, e.g. "Highest", "High", "Medium", "Low", "Lowest". Null if not set. */
  priority: string | null;

  /**
   * True if the issue was added to the sprint AFTER sprint start
   * (using the 5-minute grace period defined in PlanningService).
   */
  addedMidSprint: boolean;

  /**
   * Roadmap link status for the issue:
   *  - 'in-scope'  : issue is linked (via epic or direct link) to a JPD idea AND either:
   *                    (a) completed on or before idea.targetDate, OR
   *                    (b) in-flight (not done/cancelled) in an active sprint
   *                        with idea.targetDate not yet lapsed (green tick)
   *  - 'linked'    : issue is linked to a JPD idea but neither (a) nor (b)
   *                  applies (amber tick — on roadmap but overdue or not started in
   *                  a closed sprint)
   *  - 'none'      : no roadmap link, or issue is cancelled (dash)
   */
  roadmapStatus: 'in-scope' | 'linked' | 'none';

  /**
   * Source of the roadmap link:
   *  - 'epic'   : linked via the issue's epic key → JPD deliveryIssueKeys
   *  - 'direct' : linked via a direct Jira issue link (roadmapLinkTypes, ADR 0044)
   *  - null     : no roadmap link (roadmapStatus === 'none')
   */
  roadmapLinkSource: 'epic' | 'direct' | null;

  /**
   * True if the issue matches incidentIssueTypes OR incidentLabels
   * from BoardConfig. This is the MTTR signal.
   */
  isIncident: boolean;

  /**
   * True if the issue matches failureIssueTypes OR failureLabels
   * from BoardConfig, AND passes the failureLinkTypes AND-gate.
   * When failureLinkTypes is non-empty, the issue must also have a matching
   * causal Jira link (e.g. 'caused by') to be classified as a failure.
   * When failureLinkTypes is empty (the default), the link gate is skipped
   * and all type/label matches qualify. This is the CFR signal.
   * See Proposal 0032.
   */
  isFailure: boolean;

  /**
   * True if the issue transitioned to a doneStatusName between
   * sprint.startDate and sprint.endDate (inclusive), or if the
   * issue's current status is already in doneStatusNames.
   */
  completedInSprint: boolean;

  /**
   * Lead time in days, or null if it cannot be computed.
   * = (firstInProgressTransitionDate OR issue.createdAt) → firstDoneTransitionDate
   * Negative values (data anomalies) are clamped to null.
   * Rounded to 2 decimal places.
   */
  leadTimeDays: number | null;

  /**
   * ISO 8601 timestamp of the issue's first done-status transition,
   * or null if no such transition is found.
   */
  resolvedAt: string | null;

  /**
   * Deep link to the issue in Jira Cloud.
   * Constructed as: `${JIRA_BASE_URL}/browse/${key}`
   * Empty string if JIRA_BASE_URL is not configured.
   */
  jiraUrl: string;
}

export interface SprintDetailSummary {
  /** Count of issues present at sprint start that have not been removed
   *  (excludes issues removed from the sprint mid-flight) */
  committedCount: number;

  /** Count of issues added after sprint start */
  addedMidSprintCount: number;

  /** Count of issues removed during the sprint */
  removedCount: number;

  /** Count of issues completed within the sprint window */
  completedInSprintCount: number;

  /** Count of issues linked to a JPD roadmap item */
  roadmapLinkedCount: number;

  /** Count of issues classified as incidents (MTTR signal) */
  incidentCount: number;

  /** Count of issues classified as failures (CFR signal) */
  failureCount: number;

  /** Median lead time in days across completed issues, or null if no completed issues */
  medianLeadTimeDays: number | null;
}

export interface SprintDetailResponse {
  sprintId: string;
  sprintName: string;
  state: string;             // 'active' | 'closed' | 'future'
  startDate: string | null;  // ISO 8601
  endDate: string | null;    // ISO 8601

  /** The BoardConfig rules applied to derive annotations */
  boardConfig: SprintDetailBoardConfig;

  /** Aggregate summary bar counts */
  summary: SprintDetailSummary;

  /**
   * All issues that were part of this sprint (committed + added - removed).
   * Epics and Sub-tasks are excluded.
   * Sorted: incomplete issues first (alphabetical by key), then completed.
   */
  issues: SprintDetailIssue[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SprintDetailService {
  private readonly logger = new Logger(SprintDetailService.name);
  private readonly jiraBaseUrl: string;

  constructor(
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    @InjectRepository(JpdIdea)
    private readonly jpdIdeaRepo: Repository<JpdIdea>,
    @InjectRepository(RoadmapConfig)
    private readonly roadmapConfigRepo: Repository<RoadmapConfig>,
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
    private readonly configService: ConfigService,
    private readonly workingTimeService: WorkingTimeService,
    private readonly sprintMembership: SprintMembershipService,
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
    sprintId: string,
  ): Promise<SprintDetailResponse> {
    // -----------------------------------------------------------------------
    // Query 1: Load sprint
    // -----------------------------------------------------------------------
    const sprint = await this.sprintRepo.findOne({
      where: { id: sprintId, boardId },
    });
    if (!sprint) {
      throw new NotFoundException(
        `Sprint "${sprintId}" not found on board "${boardId}"`,
      );
    }

    // -----------------------------------------------------------------------
    // Query 2: Load BoardConfig — reject Kanban boards
    // -----------------------------------------------------------------------
    const boardConfig = await this.boardConfigRepo.findOne({
      where: { boardId },
    });
    if (boardConfig?.boardType === 'kanban') {
      throw new BadRequestException(
        'Sprint detail view is not available for Kanban boards',
      );
    }

    const doneStatusNames: string[] = boardConfig?.doneStatusNames ?? [
      'Done',
      'Closed',
      'Released',
    ];
    const failureIssueTypes: string[] = boardConfig?.failureIssueTypes ?? ['Bug', 'Incident'];
    const failureLabels: string[] = boardConfig?.failureLabels ?? ['regression', 'incident', 'hotfix'];
    const failureLinkTypes: string[] = boardConfig?.failureLinkTypes ?? [];
    const incidentIssueTypes: string[] = boardConfig?.incidentIssueTypes ?? ['Bug', 'Incident'];
    const incidentLabels: string[] = boardConfig?.incidentLabels ?? [];
    const cancelledStatusNames: string[] = boardConfig?.cancelledStatusNames ?? ['Cancelled', "Won't Do"];
    const incidentPriorities: string[] = boardConfig?.incidentPriorities ?? ['Critical'];
    // C-1 (proposal 0055): use the board's configured in-progress status names
    // (or the shared default list) instead of a hardcoded literal.
    const inProgressStatusNames: readonly string[] =
      boardConfig?.inProgressStatusNames ?? DEFAULT_IN_PROGRESS_NAMES;

    const boardConfigShape: SprintDetailBoardConfig = {
      doneStatusNames,
      failureIssueTypes,
      failureLabels,
      failureLinkTypes,
      incidentIssueTypes,
      incidentLabels,
    };

    // -----------------------------------------------------------------------
    // Query 3: Load all board issues (needed to replay changelogs correctly)
    // Cannot rely on sprintId column — it stores only the last-synced sprint.
    // -----------------------------------------------------------------------
    const allBoardIssues = await this.issueRepo.find({
      where: { boardId },
    });

    // Filter out Epics and Sub-tasks immediately
    const boardIssues = allBoardIssues.filter(
      (i) => isWorkItem(i.issueType),
    );

    if (boardIssues.length === 0) {
      return this.buildEmptyResponse(sprint, boardConfigShape);
    }

    const issueByKey = new Map<string, JiraIssue>(
      boardIssues.map((i) => [i.key, i]),
    );

    // -----------------------------------------------------------------------
    // Sprint membership reconstruction — delegated to the canonical service
    // (ADR 0049). Owns its own queries for changelogs, closed sprint names,
    // and the JiraIssueSprint join table.
    // -----------------------------------------------------------------------
    const membership = await this.sprintMembership.reconstruct({
      sprint,
      boardId,
      boardIssues,
    });

    const { committedKeys, addedKeys, committedRemovedKeys, addedRemovedKeys } =
      membership;
    const sprintStart = sprint.startDate;

    // Build final issue set: (committed ∪ added) \ (every key that left).
    // The detail view shows "issues currently in the sprint", so we exclude
    // both committed-removed AND added-then-removed — preserving the semantic
    // of the old single `removedKeys` spread (proposal 0050 / ADR 0052).
    const finalIssueKeys = new Set<string>([...committedKeys, ...addedKeys]);
    for (const key of committedRemovedKeys) {
      finalIssueKeys.delete(key);
    }
    for (const key of addedRemovedKeys) {
      finalIssueKeys.delete(key);
    }

    if (finalIssueKeys.size === 0) {
      return this.buildEmptyResponse(sprint, boardConfigShape);
    }

    // -----------------------------------------------------------------------
    // Query 6: Bulk-load status-field changelogs for sprint member issues
    // -----------------------------------------------------------------------
    const finalKeys = [...finalIssueKeys];
    const statusChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: finalKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Group status changelogs by issue
    const statusLogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of statusChangelogs) {
      const list = statusLogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      statusLogsByIssue.set(cl.issueKey, list);
    }

    // -----------------------------------------------------------------------
    // failureLinkTypes AND-gate: bulk causal-link query (Query 6b)
    //
    // When failureLinkTypes is non-empty, only issues with a matching causal
    // link (e.g. 'caused by') are classified as failures.  When
    // failureLinkTypes is empty (the default), all type/label matches qualify.
    // See Proposal 0032.
    // -----------------------------------------------------------------------
    let keysWithCausalLink = new Set<string>();
    if (failureLinkTypes.length > 0) {
      const linkRows = await this.issueLinkRepo
        .createQueryBuilder('l')
        .select('l.sourceIssueKey', 'key')
        .where('l.sourceIssueKey IN (:...keys)', { keys: finalKeys })
        .andWhere('LOWER(l.linkTypeName) IN (:...types)', {
          types: failureLinkTypes.map((t) => t.toLowerCase()),
        })
        .getRawMany<{ key: string }>();
      keysWithCausalLink = new Set(linkRows.map((r) => r.key));
    }

    // -----------------------------------------------------------------------
    // Queries 6 & 7: Load roadmap ideas (RoadmapConfig-scoped)
    //
    // Build epicKey → targetDate map with no date-window filter.
    // Per-issue classification happens in the annotation loop below using
    // doneTransition.changedAt vs idea.targetDate (end-of-day UTC).
    // -----------------------------------------------------------------------
    const roadmapConfigs = await this.roadmapConfigRepo.find();
    const epicIdeaMap = new Map<string, { targetDate: Date }>();
    let jpdIdeasAll: JpdIdea[] = [];

    if (roadmapConfigs.length > 0) {
      const jpdKeys = roadmapConfigs.map((c) => c.jpdKey);
      jpdIdeasAll = await this.jpdIdeaRepo.find({
        where: { jpdKey: In(jpdKeys) },
      });

      for (const idea of jpdIdeasAll) {
        if (!idea.deliveryIssueKeys || idea.targetDate === null) continue;
        for (const epicKey of idea.deliveryIssueKeys.filter(Boolean)) {
          const existing = epicIdeaMap.get(epicKey);
          if (!existing || idea.targetDate > existing.targetDate) {
            epicIdeaMap.set(epicKey, { targetDate: idea.targetDate });
          }
        }
      }
    }

    // Direct-link coverage map (ADR 0044).
    // Only queried when roadmapLinkTypes is non-empty (feature flag).
    const roadmapLinkTypes: string[] = boardConfig?.roadmapLinkTypes ?? [];
    const directLinkIdeaMap = await buildDirectLinkIdeaMap(
      this.issueLinkRepo,
      finalKeys,
      jpdIdeasAll,
      roadmapLinkTypes,
    );

    // -----------------------------------------------------------------------
    // Derive per-issue annotations
    // -----------------------------------------------------------------------
    const issues: SprintDetailIssue[] = [];

    // Load working-time config once for the whole batch.
    const wtEntity = await this.workingTimeService.getConfig();
    const wtConfig = this.workingTimeService.toConfig(wtEntity);

    for (const issueKey of finalIssueKeys) {
      const issue = issueByKey.get(issueKey);
      if (!issue) continue;

      const issueLogs = statusLogsByIssue.get(issueKey) ?? [];

      // addedMidSprint
      const addedMidSprint = addedKeys.has(issueKey);

      // isIncident: must match type/label AND pass priority AND-gate
      // (consistent with MttrService; incidentPriorities = [] means all priorities qualify)
      const matchesIncidentTypeOrLabel =
        incidentIssueTypes.includes(issue.issueType) ||
        (incidentLabels.length > 0 &&
          issue.labels.some((l) => incidentLabels.includes(l)));
      const isIncident =
        matchesIncidentTypeOrLabel &&
        (incidentPriorities.length === 0 ||
          incidentPriorities.includes(issue.priority ?? ''));

      // isFailure: type/label match AND causal-link gate
      // failureLinkTypes AND-gate: when configured, only issues with a matching
      // causal link (e.g. 'caused by') are classified as failures.  When
      // failureLinkTypes is empty (the default), all type/label matches qualify.
      // See Proposal 0032.
      const passesTypeGate =
        failureIssueTypes.includes(issue.issueType) ||
        issue.labels.some((l) => failureLabels.includes(l));
      const passesLinkGate =
        failureLinkTypes.length === 0 || keysWithCausalLink.has(issue.key);
      const isFailure = passesTypeGate && passesLinkGate;

      // completedInSprint
      // Case 1 (changelog): a status changelog transitioned TO a done status
      // within the sprint window (>= startDate guard prevents crediting
      // completions from a prior sprint).
      const sprintWindowEnd = sprint.endDate ?? new Date();
      const completedByChangelog =
        sprintStart !== null &&
        issueLogs.some(
          (cl) =>
            doneStatusNames.includes(cl.toValue ?? '') &&
            cl.changedAt >= sprintStart &&
            cl.changedAt <= sprintWindowEnd,
        );

      // Case 2 (fallback): no status changelog exists at all (truly truncated
      // data — issue was created directly in the sprint with no transitions
      // recorded) and the current status is already in doneStatusNames.
      // Must NOT fire when changelog exists but done-transition is absent
      // (e.g. completed in a prior sprint and still showing as done).
      const completedInSprint =
        completedByChangelog ||
        (issueLogs.length === 0 && doneStatusNames.includes(issue.status));

      // leadTimeDays and resolvedAt
      // Use first In Progress (or any configured in-progress status) → Done;
      // fall back to createdAt → Done. C-1 (proposal 0055).
      const inProgressTransition = issueLogs.find(
        (cl) => cl.toValue !== null && inProgressStatusNames.includes(cl.toValue),
      );
      const startTime = inProgressTransition
        ? inProgressTransition.changedAt
        : issue.createdAt;

      const doneTransition = issueLogs.find((cl) =>
        doneStatusNames.includes(cl.toValue ?? ''),
      );
      const resolvedAt = doneTransition
        ? doneTransition.changedAt.toISOString()
        : null;

      // roadmapStatus: per-issue delivery against roadmap targetDate
      //
      //   in-scope (green)  = linked to idea AND:
      //                         (a) completed on or before targetDate, OR
      //                         (b) in-flight in an active sprint with targetDate not yet lapsed
      //   linked   (amber)  = linked to idea AND neither (a) nor (b)
      //   none              = no roadmap link, OR issue is cancelled
      //
      // Cancelled issues always get 'none' so they don't inflate the amber count
      // and are excluded from coverage metrics in calculateSprintAccuracy.
      let roadmapStatus: 'in-scope' | 'linked' | 'none' = 'none';
      let roadmapLinkSource: 'epic' | 'direct' | null = null;
      if (!cancelledStatusNames.includes(issue.status)) {
        // Epic link takes priority; direct link is fallback (ADR 0044)
        const epicIdea = issue.epicKey !== null ? epicIdeaMap.get(issue.epicKey) : undefined;
        const directIdea = directLinkIdeaMap.get(issue.key);
        const idea = epicIdea ?? directIdea;
        if (idea) {
          roadmapLinkSource = epicIdea ? 'epic' : 'direct';
          const targetEndOfDay = new Date(idea.targetDate.getTime());
          targetEndOfDay.setUTCHours(23, 59, 59, 999);

          const resolvedDate = doneTransition?.changedAt ?? null;

          // Condition A: delivered on time
          const deliveredOnTime = resolvedDate !== null && resolvedDate <= targetEndOfDay;

          // Condition B: in-flight and on track
          const todayStart = new Date();
          todayStart.setUTCHours(0, 0, 0, 0);
          const isInFlight =
            sprint.state === 'active' &&
            idea.targetDate >= todayStart &&
            !doneStatusNames.includes(issue.status) &&
            !cancelledStatusNames.includes(issue.status);

          roadmapStatus = deliveredOnTime || isInFlight ? 'in-scope' : 'linked';
        }
      }

      let leadTimeDays: number | null = null;
      if (doneTransition) {
        const rawDays = wtEntity.excludeWeekends
          ? this.workingTimeService.workingDaysBetween(startTime, doneTransition.changedAt, wtConfig)
          : (doneTransition.changedAt.getTime() - startTime.getTime()) / 86_400_000;
        // Clamp negative values (data anomalies) to null
        leadTimeDays =
          rawDays >= 0
            ? Math.round(rawDays * 100) / 100
            : null;
      }

      // jiraUrl
      const jiraUrl = this.jiraBaseUrl
        ? `${this.jiraBaseUrl}/browse/${issue.key}`
        : '';

      issues.push({
        key: issue.key,
        summary: issue.summary,
        currentStatus: issue.status,
        issueType: issue.issueType,
        priority: issue.priority ?? null,
        addedMidSprint,
        roadmapStatus,
        roadmapLinkSource,
        isIncident,
        isFailure,
        completedInSprint,
        leadTimeDays,
        resolvedAt,
        jiraUrl,
      });
    }

    // Sort: incomplete issues first (alphabetical by key), then completed
    issues.sort((a, b) => {
      if (a.completedInSprint !== b.completedInSprint) {
        return a.completedInSprint ? 1 : -1;
      }
      return a.key.localeCompare(b.key);
    });

    // -----------------------------------------------------------------------
    // Summary computation
    // -----------------------------------------------------------------------
    const leadTimeSamples = issues
      .filter((i) => i.leadTimeDays !== null)
      .map((i) => i.leadTimeDays as number)
      .sort((a, b) => a - b);

    const medianLeadTimeDays =
      leadTimeSamples.length > 0
        ? // TODO: extract to shared utility (see proposal §7.5)
          median(leadTimeSamples)
        : null;

    const summary: SprintDetailSummary = {
      // committedCount: issues present at sprint start that have not been removed
      // (excludes issues removed from the sprint mid-flight)
      committedCount: issues.filter((i) => !i.addedMidSprint).length,
      addedMidSprintCount: issues.filter((i) => i.addedMidSprint).length,
      removedCount: summariseMembership(membership).removedCount,
      completedInSprintCount: issues.filter((i) => i.completedInSprint).length,
      roadmapLinkedCount: issues.filter((i) => i.roadmapStatus !== 'none').length,
      incidentCount: issues.filter((i) => i.isIncident).length,
      failureCount: issues.filter((i) => i.isFailure).length,
      medianLeadTimeDays,
    };

    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      endDate: sprint.endDate ? sprint.endDate.toISOString() : null,
      boardConfig: boardConfigShape,
      summary,
      issues,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildEmptyResponse(
    sprint: JiraSprint,
    boardConfig: SprintDetailBoardConfig,
  ): SprintDetailResponse {
    return {
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state,
      startDate: sprint.startDate ? sprint.startDate.toISOString() : null,
      endDate: sprint.endDate ? sprint.endDate.toISOString() : null,
      boardConfig,
      summary: {
        committedCount: 0,
        addedMidSprintCount: 0,
        removedCount: 0,
        completedInSprintCount: 0,
        roadmapLinkedCount: 0,
        incidentCount: 0,
        failureCount: 0,
        medianLeadTimeDays: null,
      },
      issues: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (module-level, not exported)
// ---------------------------------------------------------------------------

/**
 * Compute the median of a sorted array of numbers.
 * Returns null for an empty array.
 * TODO: extract to shared utility (see proposal §7.5)
 */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const index = 0.5 * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (index - lower) * (sorted[upper] - sorted[lower]);
}
