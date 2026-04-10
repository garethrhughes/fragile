import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusIdToJiraIssues1775820878077 implements MigrationInterface {
  name = 'AddStatusIdToJiraIssues1775820878077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_issues" ADD COLUMN IF NOT EXISTS "statusId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_issues" DROP COLUMN IF EXISTS "statusId"`,
    );
  }
}
