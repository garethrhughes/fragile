import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddHealthcheckSnapshotsTable
 *
 * Creates `healthcheck_snapshots` — one row per ISO week holding the canonical
 * (`includeSupport=true`) weekly Healthcheck figure, the predicate config hash
 * it was derived under, and the derived `first_start` per ticket
 * (proposal 0086 / ADR 0092).
 *
 * Written through on the first read of a completed week. No existing table is
 * altered and no historical data is rewritten.
 */
export class AddHealthcheckSnapshotsTable1778600000000 implements MigrationInterface {
  name = 'AddHealthcheckSnapshotsTable1778600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "healthcheck_snapshots" (
        "week"        varchar     NOT NULL,
        "weekStart"   timestamptz NOT NULL,
        "weekEnd"     timestamptz NOT NULL,
        "payload"     jsonb       NOT NULL,
        "configHash"  varchar     NOT NULL,
        "firstStarts" jsonb       NOT NULL DEFAULT '{}',
        "computedAt"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_healthcheck_snapshots" PRIMARY KEY ("week")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_healthcheck_snapshots_computedAt"
       ON "healthcheck_snapshots" ("computedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_healthcheck_snapshots_computedAt"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "healthcheck_snapshots"`);
  }
}
