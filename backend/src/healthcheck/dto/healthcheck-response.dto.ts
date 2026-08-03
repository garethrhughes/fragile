import type { HealthcheckBand } from '../healthcheck-bands.js';

/**
 * Healthcheck report response (ADR 0070).
 *
 * For a selected ISO week, each board reports three scores computed against a
 * single shared denominator — tickets whose first-ever start transition fell
 * in the week. Live-computed; not persisted.
 */
export interface HealthcheckResponse {
  /** ISO week key, e.g. "2026-W30". */
  week: string;
  weekStart: string;
  weekEnd: string;
  boards: HealthcheckBoardResult[];
}

export interface HealthcheckBoardResult {
  boardId: string;
  boardType: 'scrum' | 'kanban';
  /** |D| — count of tickets that started this week. */
  denominator: number;
  stability: HealthcheckDimension;
  roadmap: HealthcheckDimension;
  support: HealthcheckDimension;
  /** Trailing 8-week trend, oldest→newest, including the selected week. */
  trend: HealthcheckTrendPoint[];
}

export interface HealthcheckDimension {
  /** Percentage in [0,100], or null when N/A. */
  score: number | null;
  /** Matching-ticket count, or null when N/A. */
  numerator: number | null;
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
