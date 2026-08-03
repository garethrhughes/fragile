import type { JiraIssue } from '../../database/entities/index.js';

/**
 * Response for GET /api/debug/issue/:key — everything stored in the Postgres
 * mirror about a single Jira issue (ADR 0076). Read-only; no live Jira data.
 */
export interface IssueDebugResponse {
  /** The full JiraIssue row. */
  issue: JiraIssue;
  /** Status and Sprint changelog rows for the key, ordered by changedAt ASC. */
  changelog: IssueDebugChangelogEntry[];
  /** Sprint memberships (JiraIssueSprint) with the referenced sprint's details. */
  sprintMemberships: IssueDebugSprintMembership[];
  /** JiraIssueLink rows where the key is the source. */
  linksAsSource: IssueDebugLink[];
  /** JiraIssueLink rows where the key is the target. */
  linksAsTarget: IssueDebugLink[];
  /** Roadmap ideas linked to this issue via its epic or a direct delivery link. */
  roadmapIdeas: IssueDebugRoadmapIdea[];
}

export interface IssueDebugChangelogEntry {
  id: number;
  field: string;
  fromValue: string | null;
  toValue: string | null;
  fromId: string | null;
  toId: string | null;
  changedAt: string;
}

export interface IssueDebugSprintMembership {
  sprintId: string;
  /** Sprint details, or null if the referenced sprint row is missing. */
  name: string | null;
  state: string | null;
  startDate: string | null;
  endDate: string | null;
  completeDate: string | null;
  boardId: string | null;
}

export interface IssueDebugLink {
  id: number;
  sourceIssueKey: string;
  targetIssueKey: string;
  linkTypeName: string;
  isInward: boolean;
}

export interface IssueDebugRoadmapIdea {
  key: string;
  summary: string;
  status: string;
  jpdKey: string;
  startDate: string | null;
  targetDate: string | null;
  /** Why this idea matched: via the issue's epic, or a direct delivery link. */
  matchReason: 'epic' | 'direct';
}
