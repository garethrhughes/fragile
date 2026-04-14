import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  JiraIssue,
  JiraSprint,
  BoardConfig,
  JiraChangelog,
} from '../database/entities/index.js';
import { isWorkItem } from '../metrics/issue-type-filters.js';
import { quarterToDates } from '../metrics/period-utils.js';

export interface GapIssue {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  boardId: string;
  sprintId: string | null;
  sprintName: string | null;
  points: number | null;
  epicKey: string | null;
  jiraUrl: string;
}

export interface GapsResponse {
  noEpic: GapIssue[];
  noEstimate: GapIssue[];
}

export interface UnplannedDoneIssue {
  key: string;
  summary: string;
  issueType: string;
  boardId: string;
  resolvedAt: string;
  resolvedStatus: string;
  points: number | null;
  epicKey: string | null;
  priority: string | null;
  assignee: string | null;
  labels: string[];
  jiraUrl: string;
}

export interface UnplannedDoneSummary {
  total: number;
  totalPoints: number;
  byIssueType: Record<string, number>;
}

export interface UnplannedDoneResponse {
  boardId: string;
  window: { start: string; end: string };
  issues: UnplannedDoneIssue[];
  summary: UnplannedDoneSummary;
}

@Injectable()
export class GapsService {
  private readonly jiraBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
  ) {
    this.jiraBaseUrl = this.configService.get<string>('JIRA_BASE_URL', '');
  }

  async getGaps(): Promise<GapsResponse> {
    // Step 1: board configs — done/cancelled status names and Kanban board IDs
    const configs = await this.boardConfigRepo.find();
    const doneByBoard = new Map<string, string[]>();
    const cancelledByBoard = new Map<string, string[]>();
    const kanbanBoardIds = new Set<string>();

    for (const cfg of configs) {
      doneByBoard.set(cfg.boardId, cfg.doneStatusNames ?? ['Done', 'Closed', 'Released']);
      cancelledByBoard.set(cfg.boardId, cfg.cancelledStatusNames ?? ['Cancelled', "Won't Do"]);
      if (cfg.boardType === 'kanban') kanbanBoardIds.add(cfg.boardId);
    }

    // Step 2: active sprints — eager load; used for the active-sprint gate AND
    // sprint name resolution (only active-sprint issues survive, so the name map
    // only needs entries for active sprints)
    const activeSprints = await this.sprintRepo.find({ where: { state: 'active' } });
    const activeSprintIds = new Set<string>(activeSprints.map((s) => s.id));
    const sprintNameMap = new Map<string, string>(activeSprints.map((s) => [s.id, s.name]));

    // Step 3: all work-item issues
    // Intentional: loads all issues across all boards for cross-board hygiene reporting.
    // Bounded dataset (single-user tool, ≤ ~5,000 rows). See proposal 0013 §Performance.
    const allIssues = (await this.issueRepo.find()).filter((i) =>
      isWorkItem(i.issueType),
    );

    // Build the Jira base URL from config
    const jiraBase = this.jiraBaseUrl;

    const noEpic: GapIssue[] = [];
    const noEstimate: GapIssue[] = [];

    for (const issue of allIssues) {
      // Step 4a: exclude done / cancelled (existing logic — unchanged)
      const done = doneByBoard.get(issue.boardId) ?? ['Done', 'Closed', 'Released'];
      const cancelled = cancelledByBoard.get(issue.boardId) ?? ['Cancelled'];
      if (done.includes(issue.status) || cancelled.includes(issue.status)) continue;

      // Steps 4b–c: active sprint gate — exclude backlog issues (null sprintId)
      // and issues assigned to closed or future sprints
      if (issue.sprintId === null || !activeSprintIds.has(issue.sprintId)) continue;

      const gap: GapIssue = {
        key: issue.key,
        summary: issue.summary,
        issueType: issue.issueType,
        status: issue.status,
        boardId: issue.boardId,
        sprintId: issue.sprintId,
        sprintName: sprintNameMap.get(issue.sprintId) ?? null,
        points: issue.points,
        epicKey: issue.epicKey,
        jiraUrl: jiraBase ? `${jiraBase}/browse/${issue.key}` : '',
      };

      // Step 4e: no-epic check — all board types
      if (issue.epicKey === null || issue.epicKey === '') noEpic.push(gap);

      // Step 4f: no-estimate check — Scrum boards only (Kanban boards excluded)
      if (issue.points === null && !kanbanBoardIds.has(issue.boardId)) noEstimate.push(gap);
    }

    // Step 6: sort both arrays by boardId ASC, then key ASC (deterministic)
    const byBoardThenKey = (a: GapIssue, b: GapIssue): number =>
      a.boardId.localeCompare(b.boardId) || a.key.localeCompare(b.key);

    noEpic.sort(byBoardThenKey);
    noEstimate.sort(byBoardThenKey);

    return { noEpic, noEstimate };
  }

  async getUnplannedDone(
    boardId: string | undefined,
    sprintId?: string,
    quarter?: string,
  ): Promise<UnplannedDoneResponse> {
    // "All boards" mode: boardId is absent or explicitly set to the sentinel "all"
    const isAllBoards = !boardId || boardId === 'all';

    if (isAllBoards) {
      return this.getUnplannedDoneAllBoards(quarter);
    }

    return this.getUnplannedDoneSingleBoard(boardId, sprintId, quarter);
  }

  /**
   * Aggregate never-boarded completions across all configured boards.
   * Scrum boards use sprint-membership classification; Kanban boards use
   * board-entry-date classification. sprintId is not supported in all-boards
   * mode — use quarter or last-90-days.
   */
  private async getUnplannedDoneAllBoards(
    quarter?: string,
  ): Promise<UnplannedDoneResponse> {
    // Determine date window
    let windowStart: Date;
    let windowEnd: Date;

    if (quarter) {
      const { startDate, endDate } = quarterToDates(quarter);
      windowStart = startDate;
      windowEnd = endDate;
    } else {
      // Default: last 90 days
      windowEnd = new Date();
      windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - 90);
    }

    // Load all board configs — include every board type
    const allConfigs = await this.boardConfigRepo.find();

    if (allConfigs.length === 0) {
      return this.buildResponse('all', windowStart, windowEnd, []);
    }

    // Collect results from each board in parallel; each board uses the correct
    // algorithm automatically (Scrum = sprint-membership, Kanban = board-entry-date)
    const perBoardResults = await Promise.all(
      allConfigs.map((cfg) =>
        this.getUnplannedDoneSingleBoard(cfg.boardId, undefined, quarter).then(
          (r) => r.issues,
        ),
      ),
    );

    // Merge and sort
    const merged: UnplannedDoneIssue[] = ([] as UnplannedDoneIssue[]).concat(
      ...perBoardResults,
    );
    merged.sort((a, b) => {
      const timeDiff =
        new Date(b.resolvedAt).getTime() - new Date(a.resolvedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.key.localeCompare(b.key);
    });

    return this.buildResponse('all', windowStart, windowEnd, merged);
  }

  private async getUnplannedDoneSingleBoard(
    boardId: string,
    sprintId?: string,
    quarter?: string,
  ): Promise<UnplannedDoneResponse> {
    // Step 1: Load BoardConfig — determine board type and done status names
    const config = await this.boardConfigRepo.findOne({ where: { boardId } });
    const isKanban = config?.boardType === 'kanban';
    const doneStatusNames: string[] = config?.doneStatusNames ?? [
      'Done',
      'Closed',
      'Released',
    ];

    // Step 2: Determine date window
    // sprintId is only meaningful for Scrum boards; ignore it for Kanban.
    let windowStart: Date;
    let windowEnd: Date;

    if (sprintId && !isKanban) {
      const sprint = await this.sprintRepo.findOne({
        where: { id: sprintId, boardId },
      });
      if (!sprint) {
        throw new BadRequestException(
          `Sprint ${sprintId} not found for board ${boardId}`,
        );
      }
      windowStart = sprint.startDate ?? new Date(0);
      windowEnd = sprint.endDate ?? new Date();
    } else if (quarter) {
      const { startDate, endDate } = quarterToDates(quarter);
      windowStart = startDate;
      windowEnd = endDate;
    } else {
      // Fallback: last 90 days
      windowEnd = new Date();
      windowStart = new Date();
      windowStart.setDate(windowStart.getDate() - 90);
    }

    // Step 3: Load all work-item issues for this board
    const allIssues = (
      await this.issueRepo.find({ where: { boardId } })
    ).filter((i) => isWorkItem(i.issueType));

    if (allIssues.length === 0) {
      return this.buildResponse(boardId, windowStart, windowEnd, []);
    }

    const allKeys = allIssues.map((i) => i.key);

    // Step 4: Bulk-load status-field changelogs for all issues
    const statusChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: allKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Group by issue key for O(1) lookups
    const statusLogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of statusChangelogs) {
      const list = statusLogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      statusLogsByIssue.set(cl.issueKey, list);
    }

    // Step 5 (Scrum only): Bulk-load Sprint-field changelogs
    let sprintLogsByIssue = new Map<string, JiraChangelog[]>();
    if (!isKanban) {
      const sprintChangelogs = await this.changelogRepo
        .createQueryBuilder('cl')
        .where('cl.issueKey IN (:...keys)', { keys: allKeys })
        .andWhere('cl.field = :field', { field: 'Sprint' })
        .orderBy('cl.changedAt', 'ASC')
        .getMany();

      for (const cl of sprintChangelogs) {
        const list = sprintLogsByIssue.get(cl.issueKey) ?? [];
        list.push(cl);
        sprintLogsByIssue.set(cl.issueKey, list);
      }
    }

    // Step 5 (Kanban only): Compute boardEntryDate per issue.
    // boardEntryDate = timestamp of first status changelog (first time the issue
    // moved through any workflow state). null means it never entered the board flow.
    const boardEntryDateByKey = new Map<string, Date | null>();
    if (isKanban) {
      for (const issue of allIssues) {
        const logs = statusLogsByIssue.get(issue.key);
        boardEntryDateByKey.set(
          issue.key,
          logs && logs.length > 0 ? logs[0].changedAt : null,
        );
      }
    }

    const jiraBase = this.jiraBaseUrl;
    const resultIssues: UnplannedDoneIssue[] = [];

    // Step 6: Classify each issue
    for (const issue of allIssues) {
      // Step 6a: Find resolvedAt — first status changelog where toValue ∈ doneStatusNames
      //          AND changedAt is within [windowStart, windowEnd]
      const statusLogs = statusLogsByIssue.get(issue.key) ?? [];
      let resolvedAt: Date | null = null;
      let resolvedStatus: string | null = null;

      for (const cl of statusLogs) {
        if (
          cl.toValue !== null &&
          doneStatusNames.includes(cl.toValue) &&
          cl.changedAt >= windowStart &&
          cl.changedAt <= windowEnd
        ) {
          resolvedAt = cl.changedAt;
          resolvedStatus = cl.toValue;
          break; // first within-window done transition
        }
      }

      // Fallback: issue has NO status changelogs at all (created directly in a done
      // state via the Jira UI), current status is done, and createdAt is within window.
      // We must NOT use this fallback when statusLogs exist but simply don't fall in
      // the window — that means the issue was completed outside this window entirely.
      if (resolvedAt === null) {
        if (
          statusLogs.length === 0 &&
          doneStatusNames.includes(issue.status) &&
          issue.createdAt >= windowStart &&
          issue.createdAt <= windowEnd
        ) {
          resolvedAt = issue.createdAt;
          resolvedStatus = issue.status;
        } else {
          continue; // skip — no resolution within window
        }
      }

      // Step 6b: Determine whether the issue was "planned" at resolution time.
      // The definition of "planned" differs by board type:
      //   Scrum  — the issue was a member of a sprint when it was resolved
      //   Kanban — the issue had entered the board's workflow before it was resolved
      let isPlanned: boolean;

      if (isKanban) {
        // Kanban: planned = boardEntryDate exists AND is before resolvedAt
        const boardEntryDate = boardEntryDateByKey.get(issue.key) ?? null;
        isPlanned = boardEntryDate !== null && boardEntryDate <= resolvedAt;
      } else {
        // Scrum: replay Sprint-field changelogs up to resolvedAt
        const sprintLogs = sprintLogsByIssue.get(issue.key) ?? [];
        let inSprint = false;

        for (const cl of sprintLogs) {
          if (cl.changedAt > resolvedAt) break;

          // Presence-only check — non-empty toValue = entered a sprint;
          // empty toValue after non-empty fromValue = removed from all sprints.
          if (cl.toValue !== null && cl.toValue.trim() !== '') {
            inSprint = true;
          }
          if (
            (cl.fromValue !== null && cl.fromValue.trim() !== '') &&
            (cl.toValue === null || cl.toValue.trim() === '')
          ) {
            inSprint = false;
          }
        }

        // Snapshot fallback: Jira doesn't record a Sprint changelog for issues
        // placed into a sprint at creation time. If there are no Sprint changelogs
        // but the snapshot sprintId is non-null, the issue was in a sprint at creation.
        if (sprintLogs.length === 0 && issue.sprintId !== null) {
          inSprint = true;
        }

        isPlanned = inSprint;
      }

      if (isPlanned) continue;

      resultIssues.push({
        key: issue.key,
        summary: issue.summary,
        issueType: issue.issueType,
        boardId: issue.boardId,
        resolvedAt: resolvedAt.toISOString(),
        resolvedStatus: resolvedStatus as string,
        points: issue.points,
        epicKey: issue.epicKey,
        priority: issue.priority,
        assignee: issue.assignee,
        labels: issue.labels,
        jiraUrl: jiraBase ? `${jiraBase}/browse/${issue.key}` : '',
      });
    }

    // Sort by resolvedAt DESC, then key ASC for ties
    resultIssues.sort((a, b) => {
      const timeDiff = new Date(b.resolvedAt).getTime() - new Date(a.resolvedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.key.localeCompare(b.key);
    });

    return this.buildResponse(boardId, windowStart, windowEnd, resultIssues);
  }

  private buildResponse(
    boardId: string,
    windowStart: Date,
    windowEnd: Date,
    issues: UnplannedDoneIssue[],
  ): UnplannedDoneResponse {
    const totalPoints = issues.reduce((acc, i) => acc + (i.points ?? 0), 0);
    const byIssueType: Record<string, number> = {};
    for (const issue of issues) {
      byIssueType[issue.issueType] = (byIssueType[issue.issueType] ?? 0) + 1;
    }

    return {
      boardId,
      window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
      },
      issues,
      summary: {
        total: issues.length,
        totalPoints,
        byIssueType,
      },
    };
  }
}
