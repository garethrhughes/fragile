import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddPerformanceIndexes
 *
 * Adds indexes on the columns most frequently used by the DORA metrics
 * pipeline.  Every metric service queries jira_issues by boardId, and
 * joins jira_changelogs by issueKey filtered to field='status'.
 *
 * All CREATE INDEX statements use IF NOT EXISTS so running migration:run
 * on a database that already has some indexes (e.g. created manually) is
 * safe.
 */
export class AddPerformanceIndexes1776300000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1776300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // jira_issues — queried by boardId in every metric service
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_issues_boardId"
       ON "jira_issues" ("boardId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_issues_issueType"
       ON "jira_issues" ("issueType")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_issues_status"
       ON "jira_issues" ("status")`,
    );

    // jira_changelogs — individual column indexes to complement the existing
    // compound (issueKey, field) index added by migration 1775795358706.
    // The single-column indexes allow the planner to use index-only scans
    // when only one predicate column is present.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_changelogs_issueKey"
       ON "jira_changelogs" ("issueKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_changelogs_field"
       ON "jira_changelogs" ("field")`,
    );
    // Compound index — already created by migration 1775795358706 but guard
    // with IF NOT EXISTS in case someone is running on a fresh schema where
    // that earlier migration ran before the index was back-ported.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_changelogs_issueKey_field"
       ON "jira_changelogs" ("issueKey", "field")`,
    );

    // jira_versions — queried by projectKey and releaseDate range
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_versions_projectKey"
       ON "jira_versions" ("projectKey")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_versions_projectKey_releaseDate"
       ON "jira_versions" ("projectKey", "releaseDate")`,
    );

    // jira_sprints — queried by boardId + state in getDoraTrend sprint mode
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_sprints_boardId"
       ON "jira_sprints" ("boardId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_jira_sprints_boardId_state"
       ON "jira_sprints" ("boardId", "state")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_sprints_boardId_state"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_sprints_boardId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_versions_projectKey_releaseDate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_versions_projectKey"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_changelogs_issueKey_field"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_changelogs_field"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_changelogs_issueKey"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_issues_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_issues_issueType"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jira_issues_boardId"`);
  }
}
