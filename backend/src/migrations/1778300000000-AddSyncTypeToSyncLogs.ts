import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proposal 0078 / ADR — Add syncType to sync_logs.
 *
 * Distinguishes a full sync (fetches every issue for a board) from an
 * incremental sync (fetches only issues changed since the last successful
 * sync, via a JQL `updated >= <watermark>` clause). The hourly cron runs
 * incremental syncs; the daily midnight cron and the default manual trigger
 * run full syncs.
 *
 * Defaults to 'full' so all existing rows — and any row written before an
 * explicit syncType is set — read as a full sync, preserving prior semantics.
 */
export class AddSyncTypeToSyncLogs1778300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_logs" ADD COLUMN IF NOT EXISTS "syncType" character varying NOT NULL DEFAULT 'full'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_logs" DROP COLUMN IF EXISTS "syncType"`,
    );
  }
}
