/**
 * sprint-window.ts
 *
 * Shared sprint time-window helpers (feature 0015, proposal 0072 / ADR 0066).
 *
 * The "effective end" of a sprint is its ACTUAL close time (`completeDate`)
 * when available, falling back to the SCHEDULED end (`endDate`), and finally
 * to `now` for active sprints that have neither.
 *
 * This is the single source of truth for the completion / membership / metric
 * window upper bound. Sprint selection, filtering, and bucketing by scheduled
 * date must continue to use `endDate` directly — do NOT use this helper for
 * those.
 */

export interface SprintWindowDates {
  /** Actual close time (Jira `completeDate`) — set only for closed sprints. */
  completeDate?: Date | null;
  /** Scheduled end (Jira `endDate`). */
  endDate?: Date | null;
}

/**
 * Effective end of a sprint's activity window: `completeDate ?? endDate ?? now`.
 *
 * `completeDate` (actual close) takes priority over `endDate` (scheduled) so
 * that work finished before a late sprint close is credited to that sprint.
 */
export function effectiveSprintEnd(
  sprint: SprintWindowDates,
  now: Date = new Date(),
): Date {
  return sprint.completeDate ?? sprint.endDate ?? now;
}
