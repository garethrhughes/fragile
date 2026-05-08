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

export type GraphKind = 'line' | 'bar' | 'area';

@Entity('custom_report_graphs')
@Index(['customReportId', 'position'])
export class CustomReportGraph {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  customReportId!: string;

  @ManyToOne(() => CustomReport, (r) => r.graphs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customReportId' })
  customReport!: CustomReport;

  @Column({ type: 'varchar', length: 10 })
  kind!: GraphKind;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany('CustomReportDataPoint', 'graph', { cascade: true, eager: false })
  dataPoints!: CustomReportDataPoint[];
}
