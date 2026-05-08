import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CustomReport } from './custom-report.entity.js';

export type FilterKind = 'select' | 'multiselect';

@Entity('custom_report_filters')
@Index(['customReportId', 'position'])
export class CustomReportFilter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  customReportId!: string;

  @ManyToOne(() => CustomReport, (r) => r.filters, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customReportId' })
  customReport!: CustomReport;

  @Column({ type: 'varchar', length: 200 })
  key!: string;

  @Column({ type: 'varchar', length: 200 })
  label!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: FilterKind;

  @Column({ type: 'jsonb', nullable: true, default: null })
  defaultValue!: string | string[] | null;

  @Column({ type: 'int', default: 0 })
  position!: number;
}
