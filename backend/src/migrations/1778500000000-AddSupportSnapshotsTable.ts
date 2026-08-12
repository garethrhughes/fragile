import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddSupportSnapshotsTable
 *
 * Creates the `support_snapshots` table used to store the pre-computed Support
 * report summary for the rolling time-period windows (7/30/90 days), written
 * post-sync by the snapshot worker / in-process fallback (proposal 0080).
 *
 * One row per (boardId, snapshotType) composite primary key.
 * snapshotType is one of: 'summary-7d', 'summary-30d', 'summary-90d'.
 */
export class AddSupportSnapshotsTable1778500000000 implements MigrationInterface {
  name = 'AddSupportSnapshotsTable1778500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_snapshots" (
        "boardId"       varchar NOT NULL,
        "snapshotType"  varchar NOT NULL,
        "payload"       jsonb   NOT NULL,
        "computedAt"    timestamptz NOT NULL DEFAULT now(),
        "triggeredBy"   varchar NOT NULL,
        "stale"         boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_support_snapshots" PRIMARY KEY ("boardId", "snapshotType")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_support_snapshots_boardId"
       ON "support_snapshots" ("boardId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_support_snapshots_boardId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "support_snapshots"`);
  }
}
