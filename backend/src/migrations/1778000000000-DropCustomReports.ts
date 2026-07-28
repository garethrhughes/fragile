import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DropCustomReports — remove the Custom Reports feature (proposal 0075, ADR 0069).
 *
 * The feature (originally ADRs 0057–0059) is being removed entirely. This
 * forward migration drops its four tables. It is destructive: all custom-report
 * data is permanently deleted. The `down()` recreates the tables (empty) so the
 * migration is reversible at the schema level — data is NOT recoverable.
 *
 * Drop order respects FK cascades:
 *   custom_report_filters → custom_report_data_points → custom_report_widgets → custom_reports
 */
export class DropCustomReports1778000000000 implements MigrationInterface {
  name = 'DropCustomReports1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_report_filters"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_report_data_points"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_report_widgets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_reports"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreate the schema as it stood after migration 1777300000000
    // (RenameGraphsToWidgets). Data is not restored.
    await queryRunner.query(`
      CREATE TABLE "custom_reports" (
        "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug"        varchar NOT NULL,
        "title"       varchar NOT NULL,
        "description" varchar,
        "layout"      jsonb,
        "createdAt"   timestamptz NOT NULL DEFAULT now(),
        "updatedAt"   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_reports" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_custom_reports_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "custom_report_widgets" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "customReportId" uuid NOT NULL,
        "kind"           varchar NOT NULL,
        "title"          varchar NOT NULL,
        "config"         jsonb,
        "columns"        jsonb,
        "statUnit"       varchar,
        "statSubtitle"   varchar,
        "statBand"       varchar,
        "position"       integer NOT NULL DEFAULT 0,
        "colSpan"        integer,
        "createdAt"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_custom_report_widgets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_report_widgets_report" FOREIGN KEY ("customReportId")
          REFERENCES "custom_reports" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "custom_report_data_points" (
        "id"                   uuid NOT NULL DEFAULT gen_random_uuid(),
        "customReportWidgetId" uuid NOT NULL,
        "label"                varchar NOT NULL,
        "series"               varchar,
        "value"                double precision NOT NULL,
        "position"             integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_custom_report_data_points" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_report_data_points_widget" FOREIGN KEY ("customReportWidgetId")
          REFERENCES "custom_report_widgets" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "custom_report_filters" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        "customReportId" uuid NOT NULL,
        "kind"           varchar NOT NULL,
        "field"          varchar NOT NULL,
        "label"          varchar NOT NULL,
        "position"       integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_custom_report_filters" PRIMARY KEY ("id"),
        CONSTRAINT "FK_custom_report_filters_report" FOREIGN KEY ("customReportId")
          REFERENCES "custom_reports" ("id") ON DELETE CASCADE
      )
    `);
  }
}
