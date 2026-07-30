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

// ---------------------------------------------------------------------------
// Target-relative roadmap banding + org scores (proposal 0073)
// ---------------------------------------------------------------------------

/**
 * Points below a team's roadmap target at which the band drops from watch to
 * at-risk. Mirrors the fixed 15-point watch band used for stability.
 */
export const ROADMAP_WATCH_MARGIN = 15;

/**
 * Classify a roadmap-delivery score relative to a team's own target:
 *   healthy   score >= target
 *   watch     score >= target - ROADMAP_WATCH_MARGIN
 *   at-risk   below
 *
 * Grades each team against its own bar (e.g. PLAT target 50, product teams 80).
 */
export function classifyRoadmapBand(score: number, target: number): HealthBand {
  if (score >= target) return 'healthy';
  if (score >= target - ROADMAP_WATCH_MARGIN) return 'watch';
  return 'at-risk';
}

/**
 * Roadmap attainment vs a team's target, as a 0–100 percentage rounded and
 * capped at 100 — so a team beating its target does not inflate an org mean.
 * A non-positive target yields 100 (avoids divide-by-zero; no meaningful bar).
 */
export function roadmapAttainment(score: number, target: number): number {
  if (target <= 0) return 100;
  return Math.min(Math.round((score / target) * 100), 100);
}

/**
 * Aggregate pre-computed bands (null = not applicable) into a distribution.
 * Used for roadmap, whose bands are target-relative and therefore computed
 * per board before aggregation.
 */
export function buildDistributionFromBands(
  bands: readonly (HealthBand | null)[],
): BandDistribution {
  const dist: BandDistribution = { healthy: 0, watch: 0, atRisk: 0, na: 0 };
  for (const band of bands) {
    if (band === null) dist.na += 1;
    else if (band === 'healthy') dist.healthy += 1;
    else if (band === 'watch') dist.watch += 1;
    else dist.atRisk += 1;
  }
  return dist;
}

/**
 * Rounded arithmetic mean of the non-null values, or null when there are none.
 * Used for the org-level overall stability and roadmap scores.
 */
export function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  const sum = present.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / present.length);
}

/**
 * Support load as a 0–100 percentage: the share of a team's weekly working set
 * that was support/reactive work. Returns 0 when there are no items (proposal
 * 0076). Shown as context only — never RAG-banded or fed into a health score.
 */
export function supportLoad(supportCount: number, totalItems: number): number {
  if (totalItems <= 0) return 0;
  return Math.round((supportCount / totalItems) * 100);
}
