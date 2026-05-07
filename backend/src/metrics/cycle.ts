import type { JiraChangelog } from '../database/entities/jira-changelog.entity.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One observed cycle for an issue: the interval between a transition into
 * an in-progress status and the next subsequent transition into a done
 * status, with no intervening reset (e.g. transition back to Backlog).
 */
export interface CycleObservation {
  issueKey: string;
  /** Timestamp of the transition into an in-progress status. */
  start: Date;
  /** Timestamp of the matching transition into a done status. */
  end: Date;
  /** True for any cycle after the first completed cycle for this issue. */
  isReopen: boolean;
}

export interface IssueCycles {
  issueKey: string;
  /** All completed cycles for the issue, oldest → newest. */
  cycles: CycleObservation[];
  /** Last completed cycle — used for aggregation (proposal 0054). */
  representative: CycleObservation;
  /**
   * Per-issue anomaly count.  Currently counts unmatched in-progress
   * transitions at the end of the changelog (an open cycle that never
   * reached Done before the data window closed).
   */
  anomalyCount: number;
}

// ---------------------------------------------------------------------------
// extractCycles — pure helper
// ---------------------------------------------------------------------------

/**
 * Parse an issue's status changelog into a sequence of completed cycles.
 *
 * A cycle is `In Progress → Done` with no intervening reset (transition
 * back into a `resetNames` status). When the issue is reopened (transition
 * out of Done back into a reset status, then back into In Progress and
 * Done again), each round-trip becomes a separate cycle.
 *
 * The representative cycle for aggregation is the last completed cycle,
 * matching how users describe the issue's actual delivery time after rework.
 *
 * Pure function — no DB access, no side effects, no clock.
 */
export function extractCycles(
  changelogs: ReadonlyArray<JiraChangelog>,
  inProgressNames: ReadonlySet<string>,
  doneNames: ReadonlySet<string>,
  resetNames: ReadonlySet<string>,
): IssueCycles | null {
  if (changelogs.length === 0) return null;

  // Lower-case lookup sets for case-insensitive comparison
  const ipLower = lowerSet(inProgressNames);
  const doneLower = lowerSet(doneNames);
  const resetLower = lowerSet(resetNames);

  // Filter to status transitions and sort ascending by changedAt
  const statusLogs = changelogs
    .filter((cl) => cl.field === 'status')
    .slice()
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());

  if (statusLogs.length === 0) return null;

  const issueKey = statusLogs[0].issueKey;
  const cycles: CycleObservation[] = [];
  let openStart: Date | null = null;
  let anomalyCount = 0;

  for (const log of statusLogs) {
    const to = (log.toValue ?? '').toLowerCase();
    if (to === '') continue;

    if (ipLower.has(to)) {
      // New IP transition. If we already had an open cycle, the prior IP is
      // superseded silently (consecutive IP→IP without intervening Done is
      // not an anomaly per the canonical definition — just take the latest).
      openStart = log.changedAt;
    } else if (doneLower.has(to)) {
      if (openStart !== null) {
        cycles.push({
          issueKey,
          start: openStart,
          end: log.changedAt,
          isReopen: cycles.length > 0,
        });
        openStart = null;
      }
      // Leading Done before any IP is ignored (per AC §4 of proposal 0054).
    } else if (resetLower.has(to)) {
      // Reset clears any open cycle (issue went back to backlog without
      // completing). Not an anomaly — it just means no cycle was completed.
      openStart = null;
    }
    // Other statuses (e.g. transient intermediate states) leave state
    // unchanged: an open cycle stays open, a closed state stays closed.
  }

  // Open IP at the end of the changelog with no terminal Done — anomaly.
  if (openStart !== null) {
    anomalyCount += 1;
  }

  if (cycles.length === 0) return null;

  return {
    issueKey,
    cycles,
    representative: cycles[cycles.length - 1],
    anomalyCount,
  };
}

// ---------------------------------------------------------------------------
// resolveResetNames — pure helper
// ---------------------------------------------------------------------------

const DEFAULT_RESET_NAMES: ReadonlyArray<string> = [
  'To Do',
  'Backlog',
  'Open',
  'Reopened',
];

/**
 * Resolve the cycle-reset status set for a board.
 *
 * Reuses `BoardConfig.boardEntryStatuses` as the reset set (proposal 0054
 * §"Resolved Decisions"). When null or empty, falls back to a hardcoded
 * default covering common Scrum start statuses.
 */
export function resolveResetNames(
  boardEntryStatuses: string[] | null,
): string[] {
  if (boardEntryStatuses && boardEntryStatuses.length > 0) {
    return boardEntryStatuses;
  }
  return [...DEFAULT_RESET_NAMES];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function lowerSet(input: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const v of input) out.add(v.toLowerCase());
  return out;
}
