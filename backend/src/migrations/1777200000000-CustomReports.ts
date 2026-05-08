import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the four custom-reports tables (proposal 0056, ADR 0057).
 *
 * Tables:
 *   custom_reports            — top-level report container
 *   custom_report_graphs      — one chart per report
 *   custom_report_data_points — time-series points per graph
 *   custom_report_filters     — declarative filter metadata per report
 */
export class CustomReports1777200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built-in from PostgreSQL 13+. The extension guard
    // is a no-op on PG 16 (our target) but keeps the migration safe on any
    // PG 13+ instance where pgcrypto was not pre-loaded.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "custom_reports" (
        "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
        "slug"        varchar(80) NOT NULL,
        "title"       varchar(200) NOT NULL,
        "description" text,
        "layout"      jsonb,
        "createdAt"   timestamptz NOT NULL DEFAULT now(),
        "updatedAt"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_reports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_custom_reports_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "custom_report_graphs" (
        "id"               uuid         NOT NULL DEFAULT gen_random_uuid(),
        "customReportId"   uuid         NOT NULL,
        "kind"             varchar(10)  NOT NULL,
        "title"            varchar(200) NOT NULL,
        "seriesKey"        varchar(100),
        "xAxisLabel"       varchar(100),
        "yAxisLabel"       varchar(100),
        "position"         integer      NOT NULL DEFAULT 0,
        "createdAt"        timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_report_graphs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_report_graphs_report"
          FOREIGN KEY ("customReportId")
          REFERENCES "custom_reports"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_custom_report_graphs_report_position"
        ON "custom_report_graphs" ("customReportId", "position")
    `);

    await queryRunner.query(`
      CREATE TABLE "custom_report_data_points" (
        "id"                   bigserial   NOT NULL,
        "customReportGraphId"  uuid        NOT NULL,
        "x"                    varchar(200) NOT NULL,
        "y"                    double precision NOT NULL,
        "series"               varchar(200),
        "dimensions"           jsonb,
        "createdAt"            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_report_data_points" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_report_data_points_graph"
          FOREIGN KEY ("customReportGraphId")
          REFERENCES "custom_report_graphs"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_custom_report_data_points_graph"
        ON "custom_report_data_points" ("customReportGraphId")
    `);

    await queryRunner.query(`
      CREATE TABLE "custom_report_filters" (
        "id"               uuid         NOT NULL DEFAULT gen_random_uuid(),
        "customReportId"   uuid         NOT NULL,
        "key"              varchar(200) NOT NULL,
        "label"            varchar(200) NOT NULL,
        "kind"             varchar(20)  NOT NULL,
        "defaultValue"     jsonb,
        "position"         integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_custom_report_filters" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_report_filters_report"
          FOREIGN KEY ("customReportId")
          REFERENCES "custom_reports"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_custom_report_filters_report_position"
        ON "custom_report_filters" ("customReportId", "position")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_report_filters"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_report_data_points"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_report_graphs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_reports"`);
  }
}
