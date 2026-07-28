import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proposal 0073 / ADR 0067 — Add roadmapDeliveryTarget to board_configs.
 *
 * Per-team roadmap-delivery target (integer percentage) used by the Health
 * Check for target-relative RAG banding and org attainment. Defaults to 80;
 * the Platform board (PLAT) is seeded to 50 to reflect its reactive workload.
 */
export class AddRoadmapDeliveryTargetToBoardConfig1777800000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "board_configs" ADD COLUMN IF NOT EXISTS "roadmapDeliveryTarget" integer NOT NULL DEFAULT 80`,
    );
    // Seed the Platform board's lower target. No-op if PLAT is not configured.
    await queryRunner.query(
      `UPDATE "board_configs" SET "roadmapDeliveryTarget" = 50 WHERE "boardId" = 'PLAT'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "board_configs" DROP COLUMN IF EXISTS "roadmapDeliveryTarget"`,
    );
  }
}
