import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Proposal 0072 / ADR 0066 — Add completeDate to jira_sprints.
 *
 * Jira returns `completeDate` (the actual sprint close time) for closed
 * sprints. Completion and sprint-scoped metric windows previously bounded on
 * the scheduled `endDate`, silently excluding work finished after the
 * scheduled end but before the real close. This column stores the actual
 * close time so the "effective end" (completeDate ?? endDate) can be used.
 *
 * Nullable — active/future sprints have no completeDate, and existing rows
 * remain null until the next sync repopulates them.
 */
export class AddCompleteDateToJiraSprints1777700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_sprints" ADD COLUMN IF NOT EXISTS "completeDate" TIMESTAMP WITH TIME ZONE`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_sprints" DROP COLUMN IF EXISTS "completeDate"`,
    );
  }
}
