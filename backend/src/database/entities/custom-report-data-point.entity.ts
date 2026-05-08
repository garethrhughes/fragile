import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CustomReportGraph } from './custom-report-graph.entity.js';

@Entity('custom_report_data_points')
@Index(['customReportGraphId'])
export class CustomReportDataPoint {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column({ type: 'uuid' })
  customReportGraphId!: string;

  @ManyToOne(() => CustomReportGraph, (g) => g.dataPoints, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customReportGraphId' })
  graph!: CustomReportGraph;

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
