import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('sync_logs')
export class SyncLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  boardId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  syncedAt!: Date;

  @Column({ default: 0 })
  issueCount!: number;

  @Column({ default: 'success' })
  status!: string; // 'success' | 'failed'

  @Column({ default: 'full' })
  syncType!: string; // 'full' | 'incremental' (proposal 0078)

  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;
}
