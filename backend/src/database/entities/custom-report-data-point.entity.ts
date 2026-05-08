import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CustomReportWidget } from './custom-report-widget.entity.js';

@Entity('custom_report_data_points')
@Index(['customReportWidgetId'])
export class CustomReportDataPoint {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  customReportWidgetId!: string;

  @ManyToOne(() => CustomReportWidget, (w) => w.dataPoints, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customReportWidgetId' })
  widget!: CustomReportWidget;

  @Column({ type: 'varchar', length: 200 })
  x!: string;

  @Column({ type: 'double precision' })
  y!: number;

  @Column({ type: 'varchar', length: 200, nullable: true, default: null })
  series!: string | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  dimensions!: Record<string, string> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
