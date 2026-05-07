import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `epicConflictResolution` column to `roadmap_configs` (proposal 0053).
 *
 * When a single epic is linked to multiple JPD ideas, this column controls
 * which idea is picked as the primary delivery commitment:
 *   - 'earliest' (default) — the strictest committed targetDate wins.
 *   - 'latest'             — legacy pre-0053 behaviour.
 *
 * Default is 'earliest' so existing rows immediately reflect the new
 * deterministic policy. Reversible.
 */
export class AddEpicConflictResolutionToRoadmapConfig1777100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE roadmap_configs
      ADD COLUMN IF NOT EXISTS "epicConflictResolution" varchar NOT NULL DEFAULT 'earliest'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE roadmap_configs
      DROP COLUMN IF EXISTS "epicConflictResolution"
    `);
  }
}
