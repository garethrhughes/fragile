import {
  Entity,
  Column,
  PrimaryColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Cycle-time snapshot types. Only the rolling time-period windows are
 * snapshotted (proposal 0079); quarter and sprint cycle-time views remain
 * live-computed.
 */
export type CycleTimeSnapshotType =
  | 'aggregate-7d'
  | 'aggregate-30d'
  | 'aggregate-90d'
  | 'trend-7d'
  | 'trend-30d'
  | 'trend-90d';

@Entity('cycle_time_snapshots')
@Index(['boardId'])
export class CycleTimeSnapshot {
  /**
   * Composite primary key: one row per board (or __org__) per snapshot type.
   */
  @PrimaryColumn()
  boardId!: string;

  @PrimaryColumn()
  snapshotType!: CycleTimeSnapshotType;

  /**
   * The full serialised result from MetricsService.getCycleTime() (aggregate)
   * or getCycleTimeTrend() (trend). Stored as JSONB.
   */
  @Column({ type: 'jsonb' })
  payload!: object;

  /**
   * Wall-clock timestamp when this snapshot was last computed.
   * Used by the API to attach staleness metadata to the response.
   */
  @UpdateDateColumn({ type: 'timestamptz' })
  computedAt!: Date;

  /**
   * The boardId of the sync that triggered this computation. Matches
   * SyncLog.boardId for correlation in debugging.
   */
  @Column({ type: 'varchar' })
  triggeredBy!: string;

  /**
   * Reserved for future explicit invalidation. Staleness is computed at read
   * time from computedAt — not stored.
   */
  @Column({ default: false })
  stale!: boolean;
}
