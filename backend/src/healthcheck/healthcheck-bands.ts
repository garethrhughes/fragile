/**
 * healthcheck-bands.ts
 *
 * Pure RAG (red/amber/green) band classification for the three Healthcheck
 * scores (ADR 0073). No side effects, no DB.
 *
 *   - Stability (higher better): green ≥ 80, amber ≥ 60, else red.
 *   - Roadmap   (higher better, target-relative): green ≥ target,
 *                amber ≥ 60% of target, else red.
 *   - Support   (burden, lower better): green ≤ 20, amber ≤ 40, else red.
 *
 * A null score (N/A) yields a null band (rendered as a neutral empty state).
 */

export type HealthcheckBand = 'green' | 'amber' | 'red';

const STABILITY_GREEN = 80;
const STABILITY_AMBER = 60;
const ROADMAP_AMBER_FRACTION = 0.6;
const SUPPORT_GREEN_MAX = 20;
const SUPPORT_AMBER_MAX = 40;

export function classifyStabilityBand(score: number | null): HealthcheckBand | null {
  if (score === null) return null;
  if (score >= STABILITY_GREEN) return 'green';
  if (score >= STABILITY_AMBER) return 'amber';
  return 'red';
}

export function classifyRoadmapBand(
  score: number | null,
  target: number,
): HealthcheckBand | null {
  if (score === null) return null;
  if (score >= target) return 'green';
  if (score >= target * ROADMAP_AMBER_FRACTION) return 'amber';
  return 'red';
}

export function classifySupportBand(score: number | null): HealthcheckBand | null {
  if (score === null) return null;
  if (score <= SUPPORT_GREEN_MAX) return 'green';
  if (score <= SUPPORT_AMBER_MAX) return 'amber';
  return 'red';
}
