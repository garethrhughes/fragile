import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJiraIssueSprintsDropSprintId1776900000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the join table for multi-sprint issue membership (ADR 0048)
    await queryRunner.query(`
      CREATE TABLE "jira_issue_sprints" (
        "issueKey"  character varying NOT NULL,
        "sprintId"  character varying NOT NULL,
        CONSTRAINT "PK_jira_issue_sprints" PRIMARY KEY ("issueKey", "sprintId")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_jira_issue_sprints_sprintId" ON "jira_issue_sprints" ("sprintId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_jira_issue_sprints_issueKey" ON "jira_issue_sprints" ("issueKey")`,
    );

    // Drop the deprecated scalar sprintId column from jira_issues (ADR 0048)
    await queryRunner.query(
      `ALTER TABLE "jira_issues" DROP COLUMN IF EXISTS "sprintId"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the scalar sprintId column (will be NULL for all rows — data is not recovered)
    await queryRunner.query(
      `ALTER TABLE "jira_issues" ADD COLUMN "sprintId" character varying`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_jira_issue_sprints_issueKey"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_jira_issue_sprints_sprintId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "jira_issue_sprints"`);
  }
}
