import {
  Entity,
  Column,
  PrimaryColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Cycle-time snapshot types.
 *   - Rolling time-period windows (proposal 0079): aggregate/trend-{7,30,90}d.
 *   - Quarter views (proposal 0082): aggregate/trend-<YYYY-QN> for every quarter
 *     the UI can request. Sprint views remain live-computed.
 */
type QuarterLabel = `${number}-Q${1 | 2 | 3 | 4}`;
export type CycleTimeSnapshotType =
  | 'aggregate-7d'
  | 'aggregate-30d'
  | 'aggregate-90d'
  | 'trend-7d'
  | 'trend-30d'
  | 'trend-90d'
  | `aggregate-${QuarterLabel}`
  | 'trend-quarters';

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
