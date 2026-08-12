import {
  Entity,
  Column,
  PrimaryColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Support snapshot types.
 *   - Rolling time-period window summaries (proposal 0080): summary-{7,30,90}d.
 *   - Quarter summaries (proposal 0082): summary-<YYYY-QN> for every quarter the
 *     UI can request. Sprint summaries and the per-ticket list remain live.
 */
type QuarterLabel = `${number}-Q${1 | 2 | 3 | 4}`;
export type SupportSnapshotType =
  | 'summary-7d'
  | 'summary-30d'
  | 'summary-90d'
  | `summary-${QuarterLabel}`;

@Entity('support_snapshots')
@Index(['boardId'])
export class SupportSnapshot {
  /**
   * Composite primary key: one row per board (or __org__) per snapshot type.
   */
  @PrimaryColumn()
  boardId!: string;

  @PrimaryColumn()
  snapshotType!: SupportSnapshotType;

  /**
   * The serialised SupportSummaryDto from SupportService.getSupportSummary().
   * Stored as JSONB.
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
