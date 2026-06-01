// ---------------------------------------------------------------------------
// Shared roadmap classification utility
// ---------------------------------------------------------------------------
//
// Eliminates duplication of the "Condition A + B" roadmap classification logic
// that was previously copy-pasted across:
//   - week-detail.service.ts (inline + classifyRoadmapStatus method)
//   - sprint-detail.service.ts (inline)
//   - quarter-detail.service.ts (inline)
//   - roadmap.service.ts (getAccuracy)
//   - all-items.service.ts (classifyRoadmap — simplified Condition A only)
//
// This is a pure function with no side effects, no DB calls, no injected deps.
// ---------------------------------------------------------------------------

/**
 * Minimal idea shape needed for classification.
 * Both epic-linked and direct-linked ideas satisfy this.
 */
export interface RoadmapIdea {
  targetDate: Date | null;
}

/**
 * Input for the roadmap classification function.
 */
export interface RoadmapClassificationInput {
  /** Current issue status string (e.g. 'In Progress', 'Done'). */
  issueStatus: string;
  /** Whether the issue is in a cancelled status. */
  isCancelled: boolean;
  /** Idea resolved via epic link (takes priority per ADR 0044). */
  epicIdea: RoadmapIdea | undefined;
  /** Idea resolved via direct issue link (fallback). */
  directIdea: RoadmapIdea | undefined;
  /** Date the issue transitioned to a done status, or null if not yet done. */
  resolvedDate: Date | null;
  /** Whether the current period (sprint/week/quarter) is active. */
  isPeriodActive: boolean;
  /** List of status names considered "done" for this board. */
  doneStatusNames: string[];
  /**
   * UTC midnight of "today" for Condition B comparison.
   * Defaults to current UTC midnight if not provided.
   * Callers should supply this for deterministic results in tests.
   */
  todayStart?: Date;
}

/**
 * Result of roadmap classification.
 */
export interface RoadmapClassificationResult {
  /** 'in-scope' (green), 'linked' (amber), or 'none' (no link / cancelled). */
  status: 'in-scope' | 'linked' | 'none';
  /** Which link path was used, or null if no link applies. */
  linkSource: 'epic' | 'direct' | null;
}

/**
 * Classify an issue's roadmap status using the standard Condition A + B logic.
 *
 * - **Condition A (delivered on time):** resolvedDate <= idea.targetDate (end of day)
 * - **Condition B (in-flight on track):** period is active AND target not yet passed
 *   AND issue is not resolved AND issue is not in a done or cancelled status
 *
 * Returns 'in-scope' when either condition is met, 'linked' when an idea exists
 * but neither condition applies, and 'none' when no roadmap link exists or the
 * issue is cancelled.
 */
export function classifyRoadmapStatus(input: RoadmapClassificationInput): RoadmapClassificationResult {
  const {
    isCancelled,
    epicIdea,
    directIdea,
    resolvedDate,
    isPeriodActive,
    issueStatus,
    doneStatusNames,
  } = input;

  // Cancelled issues always get 'none' — they don't inflate coverage metrics
  if (isCancelled) {
    return { status: 'none', linkSource: null };
  }

  // Epic link takes priority; direct link is fallback (ADR 0044)
  const idea = epicIdea ?? directIdea;
  if (!idea) {
    return { status: 'none', linkSource: null };
  }

  const linkSource: 'epic' | 'direct' = epicIdea ? 'epic' : 'direct';

  // Null targetDate → linked but cannot be classified as in-scope
  if (idea.targetDate === null) {
    return { status: 'linked', linkSource };
  }

  // End-of-day boundary for targetDate comparison
  const targetEndOfDay = new Date(idea.targetDate.getTime());
  targetEndOfDay.setUTCHours(23, 59, 59, 999);

  // Condition A: delivered on time
  const deliveredOnTime = resolvedDate !== null && resolvedDate <= targetEndOfDay;

  // Condition B: in-flight on an active period with target not yet passed
  const todayStart = input.todayStart ?? defaultTodayStart();
  const isInFlight =
    isPeriodActive &&
    idea.targetDate >= todayStart &&
    resolvedDate === null &&
    !doneStatusNames.includes(issueStatus) &&
    !isCancelled;

  const status = (deliveredOnTime || isInFlight) ? 'in-scope' : 'linked';
  return { status, linkSource };
}

/**
 * Simplified classification for contexts that only need Condition A (delivered on time).
 * Used by all-items.service.ts where in-flight status is not relevant.
 */
export function isDeliveredOnRoadmap(
  epicIdea: RoadmapIdea | undefined,
  directIdea: RoadmapIdea | undefined,
  completedAt: Date | null,
): boolean {
  if (completedAt === null) return false;

  const idea = epicIdea ?? directIdea;
  if (!idea || idea.targetDate === null) return false;

  const targetEndOfDay = new Date(idea.targetDate.getTime());
  targetEndOfDay.setUTCHours(23, 59, 59, 999);
  return completedAt <= targetEndOfDay;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function defaultTodayStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
