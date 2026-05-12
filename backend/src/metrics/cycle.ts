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
  /**
   * True when this cycle represents a reopened work item.
   *
   * A cycle is a reopen when:
   * - it is not the first cycle AND the issue passed through a reset status
   *   (e.g. To Do / Backlog) before re-entering In Progress, **or**
   * - it is the merged continuation of a premature-close pattern (Done → In
   *   Progress without an intervening reset), where the merged cycle is marked
   *   as a visible reopen via the `isPoppedContinuation` flag so callers can
   *   surface the reopen in UI annotations.
   *
   * In other words: `isReopen` is `true` for any cycle that is either after
   * the first genuine completed cycle OR is the result of merging a
   * premature-close continuation.
   */
  isReopen: boolean;
}

export interface IssueCycles {
  issueKey: string;
  /** All completed cycles for the issue, oldest → newest. */
  cycles: CycleObservation[];
  /** Last completed cycle — used for aggregation. */
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
 * A cycle spans from the first entry into any in-progress status until the
 * final transition into a done status, treating intermediate IP sub-statuses
 * (In Review, QA, etc.) as pass-throughs that do not reset the clock.
 *
 * A genuine reopen requires the issue to pass through a reset status (To Do,
 * Backlog, etc.) between Done and the next In Progress. A direct Done → In
 * Progress hop without an intervening reset is treated as a continuation of
 * the same work item — Done was premature — and the clock keeps running from
 * the original start.
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
  // Tracks whether a genuine reset status was seen since the last Done.
  // Required to distinguish Done→Reset→IP (real reopen) from Done→IP
  // (premature close — the work continued without going back to the backlog).
  let hadResetSinceDone = true;
  // Set to true when we pop a premature-Done cycle and re-open it. Both the
  // premature-close (Done→IP, no reset) and the genuine-reopen (Done→reset→IP)
  // patterns are visible reopens from the user's perspective: the issue was
  // Done and then work continued. This flag carries the reopen signal through
  // the pop so `isReopen` is set correctly on the merged cycle even though
  // `cycles` is temporarily empty after the pop.
  let isPoppedContinuation = false;

  for (const log of statusLogs) {
    const to = (log.toValue ?? '').toLowerCase();
    if (to === '') continue;

    if (ipLower.has(to)) {
      if (openStart === null) {
        if (cycles.length > 0 && !hadResetSinceDone) {
          // Done→IP with no intervening reset: the prior "Done" was premature.
          // Re-open the previous cycle's start so the clock continues from the
          // original in-progress entry rather than starting fresh.
          openStart = cycles.pop()!.start;
          isPoppedContinuation = true;
        } else {
          openStart = log.changedAt;
          isPoppedContinuation = false;
        }
      }
      // Consecutive IP→IP (e.g. In Progress → In Review → QA): leave
      // openStart unchanged — the clock started at the first IP entry.
    } else if (doneLower.has(to)) {
      if (openStart !== null) {
        cycles.push({
          issueKey,
          start: openStart,
          end: log.changedAt,
          isReopen: cycles.length > 0 || isPoppedContinuation,
        });
        openStart = null;
        isPoppedContinuation = false;
        hadResetSinceDone = false;
      }
      // Leading Done before any IP is ignored.
    } else if (resetLower.has(to)) {
      // Reset clears any open cycle (issue went back to backlog without
      // completing) and marks that a genuine reset has occurred.
      openStart = null;
      isPoppedContinuation = false;
      hadResetSinceDone = true;
    }
    // Other statuses leave state unchanged.
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
