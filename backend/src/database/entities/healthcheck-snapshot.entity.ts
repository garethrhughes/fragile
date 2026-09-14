import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * A persisted weekly Healthcheck figure (ADR 0092).
 *
 * One row per ISO week, holding the **canonical** view (`includeSupport=true`).
 * Written through on the first read of a completed week; never written for the
 * current (in-flight) week, and never for `includeSupport=false` — that is an
 * exploratory re-slice, not the canonical figure.
 *
 * Exists so that a closed week's numerator, denominator, ticket list and the
 * predicate configuration it was derived under are all recoverable after the
 * fact. A live recompute is diffed against this row to surface drift rather
 * than silently replacing the figure.
 */
@Entity('healthcheck_snapshots')
@Index(['computedAt'])
export class HealthcheckSnapshot {
  /** ISO week key, e.g. "2026-W35". */
  @PrimaryColumn()
  week!: string;

  @Column({ type: 'timestamptz' })
  weekStart!: Date;

  @Column({ type: 'timestamptz' })
  weekEnd!: Date;

  /**
   * The full serialised `HealthcheckResponse` for the canonical view, including
   * the pooled numerator/denominator per dimension and the complete ticket key
   * list. Stored as JSONB.
   */
  @Column({ type: 'jsonb' })
  payload!: object;

  /**
   * SHA-256 over the predicate configuration this figure was derived under:
   * per board, `inProgressStatusNames`, `boardEntryStatuses`, `doneStatusNames`,
   * `cancelledStatusNames`, `boardType`, plus the contributing board set.
   * See `healthcheck-config-hash.ts`.
   */
  @Column({ type: 'varchar' })
  configHash!: string;

  /**
   * Derived `first_start` per ticket key, ISO 8601. `first_start` is a minimum
   * over an append-only history, so across runs it must be monotonically
   * non-increasing — a later value is an invariant violation (e.g. a truncated
   * changelog) and is reported as a drift regression.
   */
  @Column({ type: 'jsonb', default: '{}' })
  firstStarts!: Record<string, string>;

  /** Wall-clock timestamp when this week was computed and stored. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  computedAt!: Date;
}
