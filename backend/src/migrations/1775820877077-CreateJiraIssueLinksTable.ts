import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJiraIssueLinksTable1775820877077
  implements MigrationInterface
{
  name = 'CreateJiraIssueLinksTable1775820877077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS jira_issue_links (
        id SERIAL PRIMARY KEY,
        "sourceIssueKey" VARCHAR NOT NULL,
        "targetIssueKey" VARCHAR NOT NULL,
        "linkTypeName" VARCHAR NOT NULL,
        "isInward" BOOLEAN NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_jira_issue_links_sourceIssueKey" ON jira_issue_links("sourceIssueKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_jira_issue_links_targetIssueKey" ON jira_issue_links("targetIssueKey")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS jira_issue_links`);
  }
}
