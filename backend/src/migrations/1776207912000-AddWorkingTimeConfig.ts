import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkingTimeConfig1776207912000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "working_time_config" (
        "id"               integer     NOT NULL DEFAULT 1,
        "excludeWeekends"  boolean     NOT NULL DEFAULT true,
        "workDays"         text        NOT NULL DEFAULT '[1,2,3,4,5]',
        "hoursPerDay"      integer     NOT NULL DEFAULT 8,
        "holidays"         text        NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_working_time_config" PRIMARY KEY ("id")
      )
    `);

    // Insert the singleton row so it is immediately available without
    // requiring a YAML seed or a manual INSERT.
    await queryRunner.query(`
      INSERT INTO "working_time_config" ("id")
      VALUES (1)
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "working_time_config"`);
  }
}
