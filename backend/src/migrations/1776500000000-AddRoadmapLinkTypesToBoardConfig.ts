import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `roadmapLinkTypes` column to `board_configs`.
 *
 * This column stores a JSON array of lower-cased Jira issue link type names
 * (e.g. ["is connected to"]) that qualify a direct issue → roadmap-idea link
 * as a roadmap coverage signal (Condition C — ADR 0044, Proposal 0041).
 *
 * Default is '[]' (feature disabled) so all existing rows are unaffected.
 */
export class AddRoadmapLinkTypesToBoardConfig1776500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE board_configs
      ADD COLUMN IF NOT EXISTS "roadmapLinkTypes" text NOT NULL DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE board_configs
      DROP COLUMN IF EXISTS "roadmapLinkTypes"
    `);
  }
}
