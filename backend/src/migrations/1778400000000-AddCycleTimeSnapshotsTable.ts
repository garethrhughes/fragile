import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddCycleTimeSnapshotsTable
 *
 * Creates the `cycle_time_snapshots` table used to store pre-computed cycle-time
 * results for the rolling time-period windows (7/30/90 days), written post-sync
 * by the snapshot worker / in-process fallback (proposal 0079).
 *
 * One row per (boardId, snapshotType) composite primary key.
 * snapshotType is one of: 'aggregate-7d', 'aggregate-30d', 'aggregate-90d',
 * 'trend-7d', 'trend-30d', 'trend-90d'.
 */
export class AddCycleTimeSnapshotsTable1778400000000 implements MigrationInterface {
  name = 'AddCycleTimeSnapshotsTable1778400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cycle_time_snapshots" (
        "boardId"       varchar NOT NULL,
        "snapshotType"  varchar NOT NULL,
        "payload"       jsonb   NOT NULL,
        "computedAt"    timestamptz NOT NULL DEFAULT now(),
        "triggeredBy"   varchar NOT NULL,
        "stale"         boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_cycle_time_snapshots" PRIMARY KEY ("boardId", "snapshotType")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_cycle_time_snapshots_boardId"
       ON "cycle_time_snapshots" ("boardId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_cycle_time_snapshots_boardId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "cycle_time_snapshots"`);
  }
}
