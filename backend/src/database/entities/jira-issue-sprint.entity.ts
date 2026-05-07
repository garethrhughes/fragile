import { Entity, PrimaryColumn, Index } from 'typeorm';

/**
 * Join table recording the full multi-sprint membership for each Jira issue.
 *
 * Populated during sync from `customfield_10020` (the sprint array field).
 * One row per (issueKey, sprintId) pair.  Rows are replaced (delete-then-insert)
 * per issue on every sync so the table always reflects Jira's current state.
 *
 * Rationale: `JiraIssue` previously carried a scalar `sprintId` column that
 * could only hold one sprint ID.  Jira issues may belong to multiple sprints
 * simultaneously (e.g. an issue moved from Sprint 1 through a grooming sprint
 * into Sprint 2 while Sprint 1 is still closed but recorded).  The scalar
 * column was silently overwritten on each sync, discarding the other memberships.
 * See ADR 0048 for the full decision record.
 */
@Entity('jira_issue_sprints')
@Index(['sprintId'])
@Index(['issueKey'])
export class JiraIssueSprint {
  @PrimaryColumn()
  issueKey!: string;

  @PrimaryColumn()
  sprintId!: string;
}
