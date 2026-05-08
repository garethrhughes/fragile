import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import type { CustomReportGraph } from './custom-report-graph.entity.js';
import type { CustomReportFilter } from './custom-report-filter.entity.js';

@Entity('custom_reports')
export class CustomReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 80 })
  slug!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text', nullable: true, default: null })
  description!: string | null;

  @Column({ type: 'jsonb', nullable: true, default: null })
  layout!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany('CustomReportGraph', 'customReport', { cascade: true, eager: false })
  graphs!: CustomReportGraph[];

  @OneToMany('CustomReportFilter', 'customReport', { cascade: true, eager: false })
  filters!: CustomReportFilter[];
}
