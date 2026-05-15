import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSprintFieldIdToJiraFieldConfig1777600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_field_config" ADD COLUMN "sprintFieldId" varchar NOT NULL DEFAULT 'customfield_10020'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_field_config" DROP COLUMN "sprintFieldId"`,
    );
  }
}
