/**
 * healthcheck-scoring.ts
 *
 * Pure scoring core for the Healthcheck report (ADR 0070).
 *
 * Every Healthcheck score is `(100 / denominator) * numerator` — a percentage
 * of the shared per-board/week denominator (tickets whose first-ever start
 * transition fell in the week). When the denominator is zero, or the dimension
 * is not applicable to the board (e.g. Stability/Roadmap on a kanban board),
 * the score is N/A (null) rather than 0.
 */

export interface HealthcheckScore {
  /** Percentage in [0,100], or null when N/A. */
  score: number | null;
  /** Matching-ticket count, or null when N/A. */
  numerator: number | null;
  /** Shared denominator (|D|). Always reported, even when the score is N/A. */
  denominator: number;
}

export interface ComputeScoreOptions {
  /**
   * When false, the score is forced to N/A (null) regardless of counts —
   * used for dimensions that do not apply to a board type (ADR 0070:
   * Stability & Roadmap are scrum-only).
   */
  applicable?: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compute a single Healthcheck score.
 *
 * @param numerator   Count of denominator tickets matching the dimension.
 * @param denominator |D| — tickets that started this week.
 */
export function computeScore(
  numerator: number,
  denominator: number,
  options: ComputeScoreOptions = {},
): HealthcheckScore {
  const applicable = options.applicable ?? true;

  if (!applicable || denominator === 0) {
    return { score: null, numerator: null, denominator };
  }

  return {
    score: round2((100 / denominator) * numerator),
    numerator,
    denominator,
  };
}
