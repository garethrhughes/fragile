import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proposal 0051 — N/A handling and weight renormalisation.
 *
 * `compositeScore` and `compositeBand` become nullable: a sprint with no
 * data in any dimension yields `compositeScore = null` (the UI shows
 * "Insufficient data") rather than a misleading neutral number.
 */
export class MakeCompositeScoreNullable1777000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sprint_reports" ALTER COLUMN "compositeScore" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sprint_reports" ALTER COLUMN "compositeBand" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Down: restore NOT NULL. Any existing null rows must be backfilled
    // before this rolls back; we deliberately do not invent a default.
    await queryRunner.query(
      `ALTER TABLE "sprint_reports" ALTER COLUMN "compositeBand" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "sprint_reports" ALTER COLUMN "compositeScore" SET NOT NULL`,
    );
  }
}
