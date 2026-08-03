import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR 0075 — Remove roadmapDeliveryTarget from board_configs.
 *
 * The per-board roadmap-delivery target has no remaining consumer after the
 * Healthcheck rebuild (ADR 0070) and org-wide refactor (ADR 0074); the Roadmap
 * RAG band now uses a fixed org target constant. This drops the column.
 *
 * `down()` restores the column (default 80) and re-seeds PLAT to 50, matching
 * the original AddRoadmapDeliveryTargetToBoardConfig migration (ADR 0067).
 */
export class RemoveRoadmapDeliveryTargetFromBoardConfig1778200000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "board_configs" DROP COLUMN IF EXISTS "roadmapDeliveryTarget"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "board_configs" ADD COLUMN IF NOT EXISTS "roadmapDeliveryTarget" integer NOT NULL DEFAULT 80`,
    );
    // Restore the Platform board's lower target. No-op if PLAT is not configured.
    await queryRunner.query(
      `UPDATE "board_configs" SET "roadmapDeliveryTarget" = 50 WHERE "boardId" = 'PLAT'`,
    );
  }
}
