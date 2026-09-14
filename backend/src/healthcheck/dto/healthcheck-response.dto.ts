import type { HealthcheckBand } from '../healthcheck-bands.js';
import type { HealthcheckDrift } from '../healthcheck-drift.js';

/**
 * Healthcheck report response (ADR 0070, ADR 0074, ADR 0092).
 *
 * For a selected ISO week, the org-wide healthcheck reports three pooled scores
 * combining all boards — Stability, Roadmap, Support — computed against a
 * per-dimension denominator (tickets whose first-ever start transition fell in
 * the week).
 *
 * A completed week's canonical figure (`includeSupport=true`) is persisted on
 * first read and served from storage by default, so a closed week is
 * reproducible. `view=live` forces a recompute and reports `drift` against the
 * stored figure rather than silently replacing it (ADR 0092).
 */
export interface HealthcheckResponse {
  /** ISO week key, e.g. "2026-W30". */
  week: string;
  weekStart: string;
  weekEnd: string;
  /**
   * Whether this payload was served from the persisted canonical figure or
   * computed live. The current (in-flight) week and any `includeSupport=false`
   * request are always `'live'`.
   */
  source: 'stored' | 'live';
  /** When this figure was computed — the stored timestamp, or now for a live view. */
  computedAt: string;
  /**
   * Fingerprint of the predicate configuration this figure was derived under
   * (per-board in-progress / board-entry / done / cancelled status names, board
   * types, and the contributing board set). Two figures are only comparable
   * when their hashes match.
   */
  configHash: string;
  /**
   * Echo of the request's `includeSupport`. Materially changes the Stability and
   * Roadmap denominator AND numerator, so the payload must say which view it is.
   */
  includeSupport: boolean;
  /** Org-wide pooled score for the selected week. */
  stability: HealthcheckDimension;
  roadmap: HealthcheckDimension;
  support: HealthcheckDimension;
  /** Trailing 8-week org trend, oldest→newest, including the selected week. */
  trend: HealthcheckTrendPoint[];
  /**
   * All tickets in the selected week's denominator across all boards
   * (first-ever start transition in the week), flagged by dimension.
   */
  tickets: HealthcheckTicketDto[];
  /**
   * Stored-vs-live comparison. Populated only on `view=live` for a week that
   * also has a stored row; `null` otherwise. Drift on a closed week is a signal
   * worth surfacing, not an error — nothing is auto-corrected.
   */
  drift: HealthcheckDrift | null;
}

export interface HealthcheckDimension {
  /** Pooled percentage in [0,100], or null when N/A (empty denominator). */
  score: number | null;
  /** Pooled matching-ticket count across contributing boards, or null when N/A. */
  numerator: number | null;
  /** Pooled denominator (Σ started tickets across contributing boards). */
  denominator: number;
  /** RAG band, or null when the score is N/A. */
  band: HealthcheckBand | null;
}

export interface HealthcheckTrendPoint {
  /** ISO week key. */
  week: string;
  stability: number | null;
  roadmap: number | null;
  support: number | null;
}

/**
 * A ticket included in the selected week's denominator, with the dimensions it
 * contributed to. `jiraUrl` is empty when JIRA_BASE_URL is not configured.
 */
export interface HealthcheckTicketDto {
  key: string;
  summary: string;
  boardId: string;
  boardType: 'scrum' | 'kanban';
  issueType: string;
  status: string;
  /**
   * The derived first-ever start transition (ISO 8601) that placed this ticket
   * in this week. A minimum over an append-only history — must be monotonically
   * non-increasing across runs (ADR 0092).
   */
  firstStart: string;
  planned: boolean;
  onRoadmap: boolean;
  support: boolean;
  jiraUrl: string;
}
