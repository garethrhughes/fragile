import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChangelogSprintIds1776800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_changelogs" ADD COLUMN "fromId" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_changelogs" ADD COLUMN "toId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_changelogs" DROP COLUMN "toId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jira_changelogs" DROP COLUMN "fromId"`,
    );
  }
}
