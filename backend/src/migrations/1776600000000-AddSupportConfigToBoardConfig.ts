import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `supportLabels`, `supportLinkType`, and `triageBoardKey` columns to
 * `board_configs` to support the Support Ticket Report (Proposal 0043 / ADR 0045).
 *
 * - `supportLabels` — JSON array of label strings that classify an issue as a
 *   support ticket (e.g. ["support", "triage"]). Default [] means disabled.
 * - `supportLinkType` — link type name to match against jira_issue_links
 *   (e.g. "clones"). Null means the link-based path is disabled.
 * - `triageBoardKey` — project key prefix for the triage board (e.g. "TTB").
 *   Used as a prefix match on targetIssueKey. Null means disabled.
 *
 * All columns are nullable / have safe defaults so existing rows are unaffected.
 */
export class AddSupportConfigToBoardConfig1776600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE board_configs
      ADD COLUMN IF NOT EXISTS "supportLabels" text NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS "supportLinkType" varchar DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS "triageBoardKey" varchar DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE board_configs
      DROP COLUMN IF EXISTS "supportLabels",
      DROP COLUMN IF EXISTS "supportLinkType",
      DROP COLUMN IF EXISTS "triageBoardKey"
    `);
  }
}
