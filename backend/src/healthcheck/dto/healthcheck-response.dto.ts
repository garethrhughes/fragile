import type { HealthcheckBand } from '../healthcheck-bands.js';

/**
 * Healthcheck report response (ADR 0070, ADR 0074).
 *
 * For a selected ISO week, the org-wide healthcheck reports three pooled scores
 * combining all boards — Stability, Roadmap, Support — computed against a
 * per-dimension denominator (tickets whose first-ever start transition fell in
 * the week). Live-computed; not persisted.
 */
export interface HealthcheckResponse {
  /** ISO week key, e.g. "2026-W30". */
  week: string;
  weekStart: string;
  weekEnd: string;
  /** Org-wide pooled score for the selected week. */
  stability: HealthcheckDimension;
  roadmap: HealthcheckDimension;
  support: HealthcheckDimension;
  /** Trailing 8-week org trend, oldest→newest, including the selected week. */
  trend: HealthcheckTrendPoint[];
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
