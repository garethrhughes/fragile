/**
 * health-check-bands.ts
 *
 * Pure RAG (red/amber/green) banding helpers for the Engineering Health Check
 * panel (feature 0014, proposal 0071).
 *
 * Banding (proposal 0071):
 *   healthy  — score >= 85
 *   watch    — 70 <= score < 85
 *   at-risk  — score < 70
 *
 * All functions are pure — no DB calls, no side effects.
 */

export type HealthBand = 'healthy' | 'watch' | 'at-risk';

export const HEALTHY_THRESHOLD = 85;
export const WATCH_THRESHOLD = 70;

/**
 * Classify a 0–100 score into a RAG band.
 * >= 85 healthy, 70–<85 watch, < 70 at-risk.
 */
export function classifyHealthBand(score: number): HealthBand {
  if (score >= HEALTHY_THRESHOLD) return 'healthy';
  if (score >= WATCH_THRESHOLD) return 'watch';
  return 'at-risk';
}

export interface BandDistribution {
  healthy: number;
  watch: number;
  atRisk: number;
  /** Boards with no score for this dimension (e.g. nothing completed this week). */
  na: number;
}

/**
 * Aggregate a list of scores (null = not applicable) into a band distribution.
 * Null scores are counted only toward `na` — they never inflate or deflate the
 * healthy/watch/at-risk buckets (proposal 0071).
 */
export function buildBandDistribution(scores: readonly (number | null)[]): BandDistribution {
  const dist: BandDistribution = { healthy: 0, watch: 0, atRisk: 0, na: 0 };
  for (const score of scores) {
    if (score === null) {
      dist.na += 1;
      continue;
    }
    const band = classifyHealthBand(score);
    if (band === 'healthy') dist.healthy += 1;
    else if (band === 'watch') dist.watch += 1;
    else dist.atRisk += 1;
  }
  return dist;
}
