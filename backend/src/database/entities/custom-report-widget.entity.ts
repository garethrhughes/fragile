import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { CustomReport } from './custom-report.entity.js';
import type { CustomReportDataPoint } from './custom-report-data-point.entity.js';

export type WidgetKind = 'line' | 'bar' | 'area' | 'table' | 'stat';
export type StatBand = 'elite' | 'high' | 'medium' | 'low' | 'none';
export type ColumnType = 'text' | 'number' | 'status' | 'priority' | 'issue' | 'link' | 'icon';

export interface ColumnDefinition {
  key: string;
  label: string;
  type: ColumnType;
  sortable?: boolean;
}

@Entity('custom_report_widgets')
@Index(['customReportId', 'position'])
export class CustomReportWidget {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  customReportId!: string;

  @ManyToOne(() => CustomReport, (r) => r.widgets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customReportId' })
  customReport!: CustomReport;

  @Column({ type: 'varchar', length: 10 })
  kind!: WidgetKind;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  seriesKey!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  xAxisLabel!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  yAxisLabel!: string | null;

  @Column({ type: 'int', default: 0 })
  position!: number;

  /** Column definitions for `table` widgets. Null for chart and stat widgets. */
  @Column({ type: 'jsonb', nullable: true, default: null })
  columns!: ColumnDefinition[] | null;

  /** Unit label shown after the primary value on `stat` widgets. */
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  statUnit!: string | null;

  /** Secondary text shown below the primary value on `stat` widgets. */
  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  statSubtitle!: string | null;

  /** Band colour for the left border on `stat` widgets. */
  @Column({ type: 'varchar', length: 20, nullable: true, default: null })
  statBand!: StatBand | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany('CustomReportDataPoint', 'widget', { cascade: true, eager: false })
  dataPoints!: CustomReportDataPoint[];
}
