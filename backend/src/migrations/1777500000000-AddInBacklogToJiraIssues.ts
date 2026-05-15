import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR 0067 — Add inBacklog boolean to jira_issues.
 *
 * For kanban boards, the Jira Agile backlog endpoint is the authoritative
 * source of whether an issue is in the backlog or on the board. This column
 * stores the result of that API call so downstream kanban metrics can exclude
 * backlog issues without relying on statusId heuristics.
 *
 * Defaults to false so all existing issues are treated as on-board until the
 * next sync populates correct values.
 */
export class AddInBacklogToJiraIssues1777500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_issues" ADD COLUMN IF NOT EXISTS "inBacklog" boolean NOT NULL DEFAULT false`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_issues" DROP COLUMN IF EXISTS "inBacklog"`,
    );
  }
}
