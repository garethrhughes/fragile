import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `supportEpics` column to `board_configs`.
 *
 * Epic keys stored here are compared case-insensitively against
 * `JiraIssue.epicKey` during support classification.
 *
 * Proposal 0045 / ADR 0047
 */
export class AddSupportEpicsToBoardConfig1776700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE board_configs
        ADD COLUMN IF NOT EXISTS "supportEpics" text NOT NULL DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE board_configs
        DROP COLUMN IF EXISTS "supportEpics"
    `);
  }
}
