import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADR 0061 — Rename supportLinkType (varchar, nullable) to supportLinkTypes
 * (simple-json string array).  Existing non-null values are preserved as
 * single-element arrays.
 */
export class SupportLinkTypePlural1777400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Add the new array column with an empty-array default
    await queryRunner.query(
      `ALTER TABLE "board_configs" ADD COLUMN IF NOT EXISTS "supportLinkTypes" text NOT NULL DEFAULT '[]'`,
    );

    // Migrate existing non-null values: wrap the single string in a JSON array
    await queryRunner.query(
      `UPDATE "board_configs"
         SET "supportLinkTypes" = json_build_array("supportLinkType")::text
       WHERE "supportLinkType" IS NOT NULL`,
    );

    // Drop the old column
    await queryRunner.query(
      `ALTER TABLE "board_configs" DROP COLUMN IF EXISTS "supportLinkType"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add the old varchar column
    await queryRunner.query(
      `ALTER TABLE "board_configs" ADD COLUMN IF NOT EXISTS "supportLinkType" varchar DEFAULT NULL`,
    );

    // Migrate back: take the first element of the array (if any)
    await queryRunner.query(
      `UPDATE "board_configs"
         SET "supportLinkType" = (
           SELECT elem
           FROM json_array_elements_text("supportLinkTypes"::json) AS elem
           LIMIT 1
         )
       WHERE "supportLinkTypes" != '[]'`,
    );

    // Drop the new column
    await queryRunner.query(
      `ALTER TABLE "board_configs" DROP COLUMN IF EXISTS "supportLinkTypes"`,
    );
  }
}
