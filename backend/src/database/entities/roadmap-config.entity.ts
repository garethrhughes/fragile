import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('roadmap_configs')
export class RoadmapConfig {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  jpdKey!: string;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  startDateFieldId!: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  targetDateFieldId!: string | null;

  /**
   * How to resolve many-ideas-to-one-epic links (proposal 0053).
   *
   * 'earliest' (default) — primary idea is the one with the earliest
   *                        targetDate; on-time check is the strictest
   *                        committed promise.
   * 'latest'             — primary idea is the one with the latest
   *                        targetDate (the legacy pre-0053 behaviour).
   *
   * Both code paths (`filterIdeasForWindow` and `buildDirectLinkIdeaMap`)
   * route through the shared `resolveEpicIdeas` helper using this value.
   */
  @Column({ type: 'varchar', default: 'earliest' })
  epicConflictResolution!: 'earliest' | 'latest';

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
