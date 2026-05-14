/**
 * Response types for GET /api/all-items
 *
 * NOTE: This DTO is part of the all-items module — a bespoke MyPass-only
 * report (feature 0012, proposal 0062). It is intentionally isolated and
 * will not be upstreamed.
 */

export interface AllItemsIssue {
  /** Jira issue key, e.g. "ACC-123" */
  key: string;
  /** Issue summary / title */
  summary: string;
  /** Jira issue type, e.g. "Story", "Bug", "Task" */
  issueType: string;
  /** Current status at time of last sync */
  status: string;
  /** Board this issue belongs to */
  boardId: string;
  /** Assignee display name, or null */
  assignee: string | null;
  /** Story points, or null */
  points: number | null;
  /** Labels on this issue */
  labels: string[];
  /** Deep link to Jira, or empty string if JIRA_BASE_URL not configured */
  jiraUrl: string;
  /** Epic key, or null */
  epicKey: string | null;
  /** Sprint name the issue was in during this week (null for kanban) */
  sprintName: string | null;

  // --- Classification flags ---

  /**
   * True if the issue had its first in-progress status transition within the
   * week (scrum) or first board-entry transition within the week (kanban).
   */
  started: boolean;

  /**
   * Scrum boards: true if the issue was added to an active sprint after that
   * sprint's startDate, and the addition occurred within the week.
   * Kanban boards: always false — use kanbanAdd instead.
   */
  addedMidSprint: boolean;

  /**
   * Kanban boards: true if the issue's board-entry date falls within the week.
   * Scrum boards: always false.
   */
  kanbanAdd: boolean;

  /**
   * True if the issue transitioned to a done status within the week window.
   */
  completed: boolean;

  /**
   * True if the issue is roadmap-aligned: it is linked to a JPD idea whose
   * targetDate is on or after the issue's completion date (or is in-flight
   * with target not yet lapsed). False for uncompleted and unlinked issues.
   */
  onRoadmap: boolean;

  /**
   * True if the issue is classified as a support item per the board's
   * supportEpics / supportLabels / supportLinkTypes + triageBoardKey config.
   */
  isSupport: boolean;

  /**
   * True if the issue matches the TTB (link-based triage board) support
   * signal specifically — i.e. has a link matching supportLinkTypes where
   * targetIssueKey starts with triageBoardKey + '-'.
   */
  isTtbSupport: boolean;
}

export interface AllItemsBoardSummary {
  totalItems: number;
  startedCount: number;
  addedMidSprintCount: number;
  completedCount: number;
  onRoadmapCount: number;
  supportCount: number;
  ttbSupportCount: number;
}

export interface BoardHealthScore {
  /**
   * 0-100 composite score: average of roadmapAlignmentScore and stabilityScore.
   * supportBurdenScore is intentionally excluded — teams should not be penalised
   * for support work they do not control.
   */
  overall: number;
  /** 0-100: completedOnRoadmap / totalCompleted * 100. 100 when nothing completed. */
  roadmapAlignmentScore: number;
  /** 0-100: (1 - supportCount / totalItems) * 100. Informational only — not in overall. */
  supportBurdenScore: number;
  /**
   * 0-100:
   * Scrum  — (1 - addedMidSprintCount / totalItems) * 100. 100 when no mid-sprint additions.
   * Kanban — min(completedCount / totalItems, 1) * 100. 100 when throughput >= intake (ADR 0062).
   */
  stabilityScore: number;
}

export interface AllItemsBoardResult {
  boardId: string;
  boardType: 'scrum' | 'kanban';
  items: AllItemsIssue[];
  summary: AllItemsBoardSummary;
  healthScore: BoardHealthScore;
}

export interface AllItemsTotals {
  totalItems: number;
  startedCount: number;
  addedMidSprintCount: number;
  completedCount: number;
  onRoadmapCount: number;
  supportCount: number;
  ttbSupportCount: number;
}

export interface AllItemsResponse {
  week: string;
  weekStart: string;
  weekEnd: string;
  boards: AllItemsBoardResult[];
  totals: AllItemsTotals;
  /**
   * Mean of all boards' healthScore.overall values for the period.
   * 100 when there are no boards with data.
   */
  overallScore: number;
}
