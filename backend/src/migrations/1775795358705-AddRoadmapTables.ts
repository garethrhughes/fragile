import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoadmapTables1775795358705 implements MigrationInterface {
  name = 'AddRoadmapTables1775795358705';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jira_issues" ADD COLUMN IF NOT EXISTS "epicKey" character varying`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "roadmap_configs" ("id" SERIAL NOT NULL, "jpdKey" character varying NOT NULL, "description" character varying, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_roadmap_configs_jpdKey" UNIQUE ("jpdKey"), CONSTRAINT "PK_roadmap_configs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "jpd_ideas" ("key" character varying NOT NULL, "summary" character varying NOT NULL, "status" character varying NOT NULL, "jpdKey" character varying NOT NULL, "deliveryIssueKeys" text, "syncedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_jpd_ideas" PRIMARY KEY ("key"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "jpd_ideas"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_configs"`);
    await queryRunner.query(
      `ALTER TABLE "jira_issues" DROP COLUMN IF EXISTS "epicKey"`,
    );
  }
}
