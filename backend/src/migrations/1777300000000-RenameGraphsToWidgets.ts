import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameGraphsToWidgets1777300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rename the table
    await queryRunner.query(`ALTER TABLE custom_report_graphs RENAME TO custom_report_widgets`);

    // 2. Rename the FK column on data points
    await queryRunner.query(
      `ALTER TABLE custom_report_data_points
         RENAME COLUMN "customReportGraphId" TO "customReportWidgetId"`,
    );

    // 3. Rename the FK constraint on data points
    await queryRunner.query(
      `ALTER TABLE custom_report_data_points
         RENAME CONSTRAINT "FK_custom_report_data_points_customReportGraphId"
         TO "FK_custom_report_data_points_customReportWidgetId"`,
    );

    // 4. Rename the index on data points
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_custom_report_data_points_customReportGraphId"
         RENAME TO "IDX_custom_report_data_points_customReportWidgetId"`,
    );

    // 5. Rename the PK constraint on the widget table (if it carried the old name)
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         RENAME CONSTRAINT "PK_custom_report_graphs" TO "PK_custom_report_widgets"`,
    );

    // 6. Rename the composite index on [customReportId, position]
    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_custom_report_graphs_customReportId_position"
         RENAME TO "IDX_custom_report_widgets_customReportId_position"`,
    );

    // 7. Rename the FK back to custom_reports
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         RENAME CONSTRAINT "FK_custom_report_graphs_customReportId"
         TO "FK_custom_report_widgets_customReportId"`,
    );

    // 8. Extend kind check constraint (drop old, add new with table + stat)
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets DROP CONSTRAINT IF EXISTS "CHK_custom_report_graphs_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         ADD CONSTRAINT "CHK_custom_report_widgets_kind"
         CHECK (kind IN ('line', 'bar', 'area', 'table', 'stat'))`,
    );

    // 9. Add new nullable columns
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         ADD COLUMN IF NOT EXISTS "columns" jsonb DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS "statUnit" varchar(200) DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS "statSubtitle" varchar(200) DEFAULT NULL,
         ADD COLUMN IF NOT EXISTS "statBand" varchar(20) DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove added columns
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         DROP COLUMN IF EXISTS "columns",
         DROP COLUMN IF EXISTS "statUnit",
         DROP COLUMN IF EXISTS "statSubtitle",
         DROP COLUMN IF EXISTS "statBand"`,
    );

    // Drop the new kind check constraint and restore the old one
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets DROP CONSTRAINT IF EXISTS "CHK_custom_report_widgets_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         ADD CONSTRAINT "CHK_custom_report_graphs_kind"
         CHECK (kind IN ('line', 'bar', 'area'))`,
    );

    // Rename constraints back
    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         RENAME CONSTRAINT "FK_custom_report_widgets_customReportId"
         TO "FK_custom_report_graphs_customReportId"`,
    );

    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_custom_report_widgets_customReportId_position"
         RENAME TO "IDX_custom_report_graphs_customReportId_position"`,
    );

    await queryRunner.query(
      `ALTER TABLE custom_report_widgets
         RENAME CONSTRAINT "PK_custom_report_widgets" TO "PK_custom_report_graphs"`,
    );

    await queryRunner.query(
      `ALTER INDEX IF EXISTS "IDX_custom_report_data_points_customReportWidgetId"
         RENAME TO "IDX_custom_report_data_points_customReportGraphId"`,
    );

    await queryRunner.query(
      `ALTER TABLE custom_report_data_points
         RENAME CONSTRAINT "FK_custom_report_data_points_customReportWidgetId"
         TO "FK_custom_report_data_points_customReportGraphId"`,
    );

    await queryRunner.query(
      `ALTER TABLE custom_report_data_points
         RENAME COLUMN "customReportWidgetId" TO "customReportGraphId"`,
    );

    await queryRunner.query(`ALTER TABLE custom_report_widgets RENAME TO custom_report_graphs`);
  }
}
