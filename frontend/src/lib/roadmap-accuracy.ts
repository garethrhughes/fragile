/**
 * Roadmap accuracy derivation helpers.
 *
 * These pure functions compute the three column values and the On-Roadmap %
 * from existing API response fields. No backend changes required — the API
 * already returns `coveredIssues` (green), `linkedCount` (green + amber),
 * and `totalIssues`.
 */

interface LinkedRow {
  linkedCount: number;
  coveredIssues: number;
}

interface TotalRow {
  totalIssues: number;
  linkedCount: number;
  cancelledCount?: number;
}

interface AggregateRow {
  totalIssues: number;
  linkedCount: number;
  coveredIssues: number;
}

/**
 * On-Roadmap (Late): issues linked to a roadmap idea but delivered late or
 * still in-flight past target (amber items).
 */
export function deriveOnRoadmapLate(row: LinkedRow): number {
  return row.linkedCount - row.coveredIssues;
}

/**
 * Off-Roadmap: issues with no roadmap link at all.
 * Excludes cancelled issues which are in totalIssues but deliberately
 * excluded from linkedCount regardless of whether they have a link.
 */
export function deriveOffRoadmap(row: TotalRow): number {
  return row.totalIssues - row.linkedCount - (row.cancelledCount ?? 0);
}

/**
 * On-Roadmap %: (On-Roadmap + On-Roadmap Late) / Total Issues * 100.
 * Equivalent to linkedCount / totalIssues * 100.
 */
export function computeOnRoadmapPercent(row: TotalRow): number {
  if (row.totalIssues === 0) return 0;
  return Math.round((row.linkedCount / row.totalIssues) * 10000) / 100;
}

/**
 * Aggregate On-Roadmap % across multiple periods (weighted mean).
 */
export function computeAggregateOnRoadmapPercent(rows: readonly AggregateRow[]): number {
  if (rows.length === 0) return 0;
  const allTotal = rows.reduce((sum, r) => sum + r.totalIssues, 0);
  const allLinked = rows.reduce((sum, r) => sum + r.linkedCount, 0);
  if (allTotal === 0) return 0;
  return Math.round((allLinked / allTotal) * 10000) / 100;
}
