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
import { classifyRoadmapStatus as classifyRoadmap } from '../metrics/roadmap-classification.js';
import { SprintMembershipService } from '../sprint-membership/sprint-membership.service.js';

// ---------------------------------------------------------------------------
// Response interfaces (exported for use by the controller and frontend types)
// ---------------------------------------------------------------------------

export interface QuarterDetailIssue {
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

  /** The quarter this issue was assigned to, e.g. "2025-Q2" */
  assignedQuarter: string;

  /** True if the issue transitioned to a done status within the quarter window */
  completedInQuarter: boolean;

  /** True if the issue's board-entry date is strictly after quarter start */
  addedMidQuarter: boolean;

  /** True if the issue is linked to a roadmap idea (via epicKey or direct issue link) and is not cancelled */
  linkedToRoadmap: boolean;

  /**
   * Roadmap delivery status:
   *   in-scope = linked to idea AND (delivered on or before targetDate [Condition A]
   *              OR in-flight on an active quarter with target not yet passed [Condition B])
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

  /** Deep link to the issue in Jira Cloud, or empty string if not configured */
  jiraUrl: string;
}

export interface QuarterDetailSummary {
  totalIssues: number;
  completedIssues: number;
  addedMidQuarter: number;
  roadmapLinkedCount: number;
  incidentCount: number;
  failureCount: number;
  totalPoints: number;
  completedPoints: number;
}

export interface QuarterDetailBoardConfig {
  boardType: string;
  doneStatusNames: string[];
}

export interface QuarterDetailResponse {
  boardId: string;
  quarter: string;
  quarterStart: string;
  quarterEnd: string;
  summary: QuarterDetailSummary;
  issues: QuarterDetailIssue[];
  boardConfig: QuarterDetailBoardConfig;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class QuarterDetailService {
  private readonly logger = new Logger(QuarterDetailService.name);
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
    quarter: string,
  ): Promise<QuarterDetailResponse> {
    // -----------------------------------------------------------------------
    // Step 1 — Parse quarter to date range
    // -----------------------------------------------------------------------
    const { quarterStart, quarterEnd } = this.parseQuarter(quarter);

    // -----------------------------------------------------------------------
    // Step 2 — Load board config
    // -----------------------------------------------------------------------
    const boardConfig = await this.boardConfigRepo.findOne({ where: { boardId } });
    const doneStatuses: string[] = boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const cancelledStatusNames: string[] = boardConfig?.cancelledStatusNames ?? ['Cancelled', "Won't Do"];
    const incidentIssueTypes: string[] = boardConfig?.incidentIssueTypes ?? ['Bug', 'Incident'];
    const incidentLabels: string[] = boardConfig?.incidentLabels ?? [];
    const incidentPriorities: string[] = boardConfig?.incidentPriorities ?? ['Critical'];
    const failureIssueTypes: string[] = boardConfig?.failureIssueTypes ?? ['Bug', 'Incident'];
    const failureLabels: string[] = boardConfig?.failureLabels ?? ['regression', 'incident', 'hotfix'];
    const failureLinkTypes: string[] = boardConfig?.failureLinkTypes ?? [];
    const roadmapLinkTypes: string[] = boardConfig?.roadmapLinkTypes ?? [];
    const boardType: string = boardConfig?.boardType ?? 'scrum';
    const backlogStatusIds: string[] = boardConfig?.backlogStatusIds ?? [];

    // -----------------------------------------------------------------------
    // Step 3 — Load all issues for board
    // -----------------------------------------------------------------------
    const issues = (await this.issueRepo.find({ where: { boardId } }))
      .filter((i) => isWorkItem(i.issueType));

    if (issues.length === 0) {
      return this.buildEmptyResponse(boardId, quarter, quarterStart, quarterEnd, boardType, doneStatuses);
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
    // C-2 (proposal 0055): for Scrum boards the entry date is delegated to
    // SprintMembershipService.firstSprintEntryDates so the Sprint changelog
    // scan lives in a single place (ADR 0049 single-source-of-truth).
    // -----------------------------------------------------------------------
    const boardEntryDateByKey = new Map<string, Date>();

    const firstSprintEntryByKey =
      boardType !== 'kanban'
        ? this.sprintMembership.firstSprintEntryDates({
            issueKeys: issues.map((i) => i.key),
            changelogsByIssue,
          })
        : new Map<string, Date>();

    for (const issue of issues) {
      const issueChangelogs = changelogsByIssue.get(issue.key) ?? [];

      let entryDate: Date;

      if (boardType === 'kanban') {
        // Kanban: earliest status changelog where fromValue = 'To Do'
        const toDoTransition = issueChangelogs.find(
          (cl) => cl.field === 'status' && cl.fromValue === 'To Do',
        );
        entryDate = toDoTransition ? toDoTransition.changedAt : issue.createdAt;
      } else {
        // Scrum: earliest Sprint changelog (via SprintMembershipService) →
        // fall back to issue.createdAt when the issue was never assigned to a
        // sprint (no Sprint-field history).
        entryDate = firstSprintEntryByKey.get(issue.key) ?? issue.createdAt;
      }

      boardEntryDateByKey.set(issue.key, entryDate);
    }

    // For Kanban boards, exclude pure-backlog issues (never pulled onto the board).
    // Primary: statusId is in backlogStatusIds. Fallback: no status changelog at all.
    const filteredIssues = boardType === 'kanban'
      ? issues.filter((issue) => {
          if (backlogStatusIds.length > 0 && issue.statusId !== null) {
            return !backlogStatusIds.includes(issue.statusId);
          }
          return issueKeysWithStatusChangelog.has(issue.key);
        })
      : issues;

    // Apply dataStartDate lower bound filter for Kanban boards (before the quarter window filter)
    const dataStartDate = boardConfig?.dataStartDate ?? null;
    const startBound = boardType === 'kanban' && dataStartDate ? new Date(dataStartDate) : null;
    const startBoundedIssues = startBound
      ? filteredIssues.filter((issue) => {
          const entryDate = boardEntryDateByKey.get(issue.key);
          return entryDate !== undefined && entryDate >= startBound;
        })
      : filteredIssues;

    // -----------------------------------------------------------------------
    // Step 6 — Filter issues to those whose boardEntryDate falls within the quarter
    // -----------------------------------------------------------------------
    const quarterIssues = startBoundedIssues.filter((issue) => {
      const entryDate = boardEntryDateByKey.get(issue.key);
      if (!entryDate) return false;
      return entryDate >= quarterStart && entryDate <= quarterEnd;
    });

    if (quarterIssues.length === 0) {
      return this.buildEmptyResponse(boardId, quarter, quarterStart, quarterEnd, boardType, doneStatuses);
    }

    // -----------------------------------------------------------------------
    // Step 6b — failureLinkTypes AND-gate: bulk causal-link query
    //
    // When failureLinkTypes is non-empty, only issues with a matching causal
    // link (e.g. 'caused by') are classified as failures.  When
    // failureLinkTypes is empty (the default), all type/label matches qualify.
    // See Proposal 0032.
    // -----------------------------------------------------------------------
    const quarterIssueKeys = quarterIssues.map((i) => i.key);
    let keysWithCausalLink = new Set<string>();
    if (failureLinkTypes.length > 0) {
      const linkRows = await this.issueLinkRepo
        .createQueryBuilder('l')
        .select('l.sourceIssueKey', 'key')
        .where('l.sourceIssueKey IN (:...keys)', { keys: quarterIssueKeys })
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

    // Direct issue → idea links (ADR 0044 Condition C)
    const directLinkIdeaMap = await buildDirectLinkIdeaMap(
      this.issueLinkRepo,
      quarterIssueKeys,
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

    // -----------------------------------------------------------------------
    // Step 8 — Build per-issue result
    // -----------------------------------------------------------------------
    const results: QuarterDetailIssue[] = [];

    for (const issue of quarterIssues) {
      const issueChangelogs = changelogsByIssue.get(issue.key) ?? [];
      const boardEntryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;

      // completedInQuarter: has a status transition to a done status within the quarter
      const completedInQuarter = issueChangelogs.some(
        (cl) =>
          cl.field === 'status' &&
          cl.toValue !== null &&
          doneStatuses.includes(cl.toValue) &&
          cl.changedAt >= quarterStart &&
          cl.changedAt <= quarterEnd,
      );

      // addedMidQuarter: boardEntryDate is strictly after quarterStart
      const addedMidQuarter = boardEntryDate > quarterStart;

      // roadmapStatus — shared Condition A + B classification
      const doneTransitionForRoadmap = issueChangelogs.find(
        (cl) =>
          cl.field === 'status' &&
          cl.toValue !== null &&
          doneStatuses.includes(cl.toValue),
      );
      const todayStartForRoadmap = new Date();
      todayStartForRoadmap.setUTCHours(0, 0, 0, 0);
      const roadmapResult = classifyRoadmap({
        issueStatus: issue.status,
        isCancelled: cancelledStatusNames.includes(issue.status),
        epicIdea: issue.epicKey !== null ? epicIdeaMap.get(issue.epicKey) : undefined,
        directIdea: directLinkIdeaMap.get(issue.key),
        resolvedDate: doneTransitionForRoadmap?.changedAt ?? null,
        isPeriodActive: todayStartForRoadmap >= quarterStart && todayStartForRoadmap <= quarterEnd,
        doneStatusNames: doneStatuses,
        todayStart: todayStartForRoadmap,
      });
      const roadmapStatus = roadmapResult.status;
      const roadmapLinkSource = roadmapResult.linkSource;

      // isIncident: must match type/label AND pass priority AND-gate
      // (consistent with MttrService; incidentPriorities = [] means all priorities qualify)
      const matchesIncidentTypeOrLabel =
        incidentIssueTypes.includes(issue.issueType) ||
        (incidentLabels.length > 0 && issue.labels.some((l) => incidentLabels.includes(l)));
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
        (failureLabels.length > 0 && issue.labels.some((l) => failureLabels.includes(l)));
      const passesLinkGate =
        failureLinkTypes.length === 0 || keysWithCausalLink.has(issue.key);
      const isFailure = passesTypeGate && passesLinkGate;

      // jiraUrl
      const jiraUrl = this.jiraBaseUrl
        ? `${this.jiraBaseUrl}/browse/${issue.key}`
        : '';

      // Derive linkedToRoadmap from roadmapStatus so cancelled issues (which
      // force roadmapStatus to 'none') cannot return linkedToRoadmap: true.
      const linkedToRoadmap = roadmapStatus !== 'none';

      results.push({
        key: issue.key,
        summary: issue.summary,
        issueType: issue.issueType,
        priority: issue.priority,
        status: issue.status,
        points: issue.points,
        epicKey: issue.epicKey,
        assignedQuarter: quarter,
        completedInQuarter,
        addedMidQuarter,
        linkedToRoadmap,
        roadmapStatus,
        roadmapLinkSource,
        isIncident,
        isFailure,
        labels: issue.labels,
        boardEntryDate: boardEntryDate.toISOString(),
        jiraUrl,
      });
    }

    // Sort: incomplete issues first (alphabetical by key), then completed
    results.sort((a, b) => {
      if (a.completedInQuarter !== b.completedInQuarter) {
        return a.completedInQuarter ? 1 : -1;
      }
      return a.key.localeCompare(b.key);
    });

    // -----------------------------------------------------------------------
    // Step 9 — Build summary
    // -----------------------------------------------------------------------
    const summary: QuarterDetailSummary = {
      totalIssues: quarterIssues.length,
      completedIssues: results.filter((r) => r.completedInQuarter).length,
      addedMidQuarter: results.filter((r) => r.addedMidQuarter).length,
      roadmapLinkedCount: results.filter((r) => r.roadmapStatus !== 'none').length,
      incidentCount: results.filter((r) => r.isIncident).length,
      failureCount: results.filter((r) => r.isFailure).length,
      totalPoints: results.reduce((s, r) => s + (r.points ?? 0), 0),
      completedPoints: results
        .filter((r) => r.completedInQuarter)
        .reduce((s, r) => s + (r.points ?? 0), 0),
    };

    // -----------------------------------------------------------------------
    // Step 10 — Return response
    // -----------------------------------------------------------------------
    return {
      boardId,
      quarter,
      quarterStart: quarterStart.toISOString(),
      quarterEnd: quarterEnd.toISOString(),
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

  private parseQuarter(quarter: string): { quarterStart: Date; quarterEnd: Date } {
    const match = quarter.match(/^(\d{4})-Q([1-4])$/);
    if (!match) {
      throw new BadRequestException(
        `Invalid quarter format: "${quarter}". Expected YYYY-QN e.g. 2025-Q2`,
      );
    }

    const year = parseInt(match[1], 10);
    const q = parseInt(match[2], 10);
    const startMonth = (q - 1) * 3;

    const quarterStart = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
    const quarterEnd = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));

    return { quarterStart, quarterEnd };
  }

  private buildEmptyResponse(
    boardId: string,
    quarter: string,
    quarterStart: Date,
    quarterEnd: Date,
    boardType: string,
    doneStatusNames: string[],
  ): QuarterDetailResponse {
    return {
      boardId,
      quarter,
      quarterStart: quarterStart.toISOString(),
      quarterEnd: quarterEnd.toISOString(),
      summary: {
        totalIssues: 0,
        completedIssues: 0,
        addedMidQuarter: 0,
        roadmapLinkedCount: 0,
        incidentCount: 0,
        failureCount: 0,
        totalPoints: 0,
        completedPoints: 0,
      },
      issues: [],
      boardConfig: {
        boardType,
        doneStatusNames,
      },
    };
  }
}
