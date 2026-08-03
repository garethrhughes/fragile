import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('board_configs')
export class BoardConfig {
  @PrimaryColumn()
  boardId!: string;

  @Column({ default: 'scrum' })
  boardType!: string; // 'scrum' | 'kanban'

  @Column('simple-array', { default: 'Done,Closed,Released' })
  doneStatusNames!: string[];

  @Column('simple-json', { default: '["Bug","Incident"]' })
  failureIssueTypes!: string[];

  @Column('simple-json', { default: '["is caused by","caused by"]' })
  failureLinkTypes!: string[];

  @Column('simple-json', { default: '["regression","incident","hotfix"]' })
  failureLabels!: string[];

  @Column('simple-json', { default: '["Bug","Incident"]' })
  incidentIssueTypes!: string[];

  @Column('simple-json', { default: '["Done","Resolved"]' })
  recoveryStatusNames!: string[];

  @Column('simple-json', { default: '[]' })
  incidentLabels!: string[];

  @Column({ type: 'simple-json', default: '["Critical"]' })
  incidentPriorities!: string[];

  /**
   * Status IDs (not names) that represent the backlog / pre-board state for
   * Kanban boards.  Issues whose current statusId is in this list have never
   * been pulled onto the board and should be excluded from flow metrics.
   * When empty the fallback heuristic (no status changelog = backlog) is used.
   */
  @Column({ type: 'simple-json', default: '[]' })
  backlogStatusIds!: string[];

  /**
   * Optional ISO date string (YYYY-MM-DD) used as a hard lower bound for
   * Kanban flow metrics.  Issues whose board-entry date is before this date
   * are excluded from all Kanban period calculations (quarters, weeks, and
   * detail views).  Null means no lower bound.
   */
  @Column({ type: 'varchar', nullable: true, default: null })
  dataStartDate!: string | null;

  /**
   * Status names that represent active work has begun on an issue.
   * Used as the cycle-time start event: first transition to one of these
   * statuses marks when engineering work began.
   * Uses simple-json to support status names containing commas.
   */
  @Column({ type: 'simple-json', default: '["In Progress"]' })
  inProgressStatusNames!: string[];

  /**
   * Status names that represent a cancelled / abandoned issue.
   * Issues whose current status matches one of these names are excluded
   * from roadmap coverage calculations (neither counted in the numerator
   * nor the denominator) and are shown with a dash in the sprint detail view.
   * Uses simple-json to support status names containing commas.
   */
  @Column({ type: 'simple-json', default: '["Cancelled","Won\'t Do"]' })
  cancelledStatusNames!: string[];

  /**
   * Status names that represent the initial board-entry state for Kanban boards.
   * An issue is considered to have "entered the board" when it first transitions
   * *to* one of these statuses.  Used by getKanbanQuarters and getKanbanWeeks
   * to determine board-entry date instead of falling back to createdAt.
   *
   * When null / not set, the extended default list is used:
   * ['To Do', 'Backlog', 'Open', 'New', 'TODO', 'OPEN', 'Selected for Development']
   *
   * See Proposal 0030 Fix C-3.
   */
  @Column({ type: 'simple-json', nullable: true, default: null })
  boardEntryStatuses!: string[] | null;

  /**
   * Lower-cased Jira issue link type names (e.g. ["is connected to"]) that,
   * when found between a sprint issue and a known JPD idea key in
   * jira_issue_links, qualify the issue as roadmap-linked even without an
   * epic-level link (Condition C — ADR 0044, Proposal 0041).
   *
   * An empty array (the default) disables the direct-link coverage path
   * entirely — preserving existing behaviour for boards that have not
   * configured this feature.
   *
   * Values are matched case-insensitively against jira_issue_links.linkTypeName.
   */
  @Column({ type: 'simple-json', default: '[]' })
  roadmapLinkTypes!: string[];

  /**
   * Labels that identify a support ticket for this board
   * (e.g. ["support", "triage"]).  An empty array disables label-based
   * classification.  Used by the Support Ticket Report (ADR 0045).
   */
  @Column({ type: 'simple-json', default: '[]' })
  supportLabels!: string[];

  /**
   * Jira issue link type names whose target points to the triage board
   * (e.g. ["clones", "is caused by"]).  An empty array disables link-based
   * classification.  Used together with `triageBoardKey` (ADR 0045, ADR 0061).
   * Replaces the former `supportLinkType` varchar field.
   */
  @Column({ type: 'simple-json', default: '[]' })
  supportLinkTypes!: string[];

  /**
   * Project key prefix for the triage board (e.g. "TTB").  An issue is
   * classified as support when a JiraIssueLink exists with
   * `linkTypeName === supportLinkType` and
   * `targetIssueKey.startsWith(triageBoardKey + '-')`.
   * Null disables link-based classification.  (ADR 0045)
   */
  @Column({ type: 'varchar', nullable: true, default: null })
  triageBoardKey!: string | null;

  /**
   * Epic keys whose child tickets count as support work
   * (e.g. ["PROJ-1", "PROJ-2"]).  Comparison is case-insensitive.
   * An empty array disables epic-based classification.  (ADR 0047)
   */
  @Column({ type: 'simple-json', default: '[]' })
  supportEpics!: string[];
}
