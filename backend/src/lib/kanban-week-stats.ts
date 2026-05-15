/**
 * kanban-week-stats.ts
 *
 * Shared pure functions for kanban weekly statistics used by:
 *   - all-items (pulse report)
 *   - week-detail
 *   - planning getKanbanWeeks
 *
 * All functions are pure (no DB calls, no side effects) — callers are
 * responsible for loading issues and changelogs, then passing them in.
 *
 * Extracted to eliminate duplicated inline logic across services (proposal 0066).
 */

import type { JiraIssue, JiraChangelog } from '../database/entities/index.js';

export const DEFAULT_BOARD_ENTRY_STATUSES: readonly string[] = [
  'To Do', 'Backlog', 'Open', 'New', 'TODO', 'OPEN', 'Selected for Development',
];

// ---------------------------------------------------------------------------
// buildKanbanBoardEntryDateMap
//
// Returns a map of issueKey → board-entry date.
// Board-entry date = the first changelog transition whose toValue (case-
// insensitive) is in boardEntryStatuses. Falls back to issue.createdAt when
// no such transition exists.
// ---------------------------------------------------------------------------

export function buildKanbanBoardEntryDateMap(
  issues: JiraIssue[],
  statusChangelogsByIssue: Map<string, JiraChangelog[]>,
  boardEntryStatuses: Set<string>, // must be pre-lowercased
): Map<string, Date> {
  const result = new Map<string, Date>();
  for (const issue of issues) {
    const logs = statusChangelogsByIssue.get(issue.key) ?? [];
    const entry = logs.find(
      (cl) =>
        cl.field === 'status' &&
        cl.toValue !== null &&
        boardEntryStatuses.has(cl.toValue.toLowerCase()),
    );
    result.set(issue.key, entry?.changedAt ?? issue.createdAt);
  }
  return result;
}

// ---------------------------------------------------------------------------
// filterKanbanIssues
//
// Applies the standard kanban candidate-pool filters in order:
//   1. backlogStatusIds — exclude issues still sitting in a pre-board status
//   2. changelog fallback — when backlogStatusIds is empty, exclude issues
//      that have never moved at all (pure backlog noise)
//   3. dataStartBound — exclude issues whose board-entry predates the
//      configured data start date
//
// Returns the filtered array ("on-board issues"). This is the pool used for
// both the completion scan and week-window filtering.
// ---------------------------------------------------------------------------

export interface FilterKanbanIssuesArgs {
  issues: JiraIssue[];
  backlogStatusIds: string[];
  issueKeysWithStatusChangelog: Set<string>;
  dataStartBound: Date | null;
  boardEntryDateByKey: Map<string, Date>;
}

export function filterKanbanIssues({
  issues,
  backlogStatusIds,
  issueKeysWithStatusChangelog,
  dataStartBound,
  boardEntryDateByKey,
}: FilterKanbanIssuesArgs): JiraIssue[] {
  return issues.filter((issue) => {
    // 1. Backlog status exclusion
    if (backlogStatusIds.length > 0) {
      if (issue.statusId !== null) {
        return !backlogStatusIds.includes(issue.statusId);
      }
      // statusId null — fall through to changelog fallback
    } else {
      // No backlogStatusIds configured — exclude issues with no changelog at all
      if (!issueKeysWithStatusChangelog.has(issue.key)) return false;
    }

    // 2. dataStartBound exclusion
    if (dataStartBound !== null) {
      const entryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;
      if (entryDate < dataStartBound) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// getKanbanPulledIn
//
// Returns the subset of filteredIssues whose board-entry date falls within
// [weekStart, weekEnd]. Optionally excludes cancelled issues.
//
// This is the "totalItems" / "issuesPulledIn" count.
// ---------------------------------------------------------------------------

export function getKanbanPulledIn(
  filteredIssues: JiraIssue[],
  boardEntryDateByKey: Map<string, Date>,
  weekStart: Date,
  weekEnd: Date,
  cancelledStatuses?: Set<string>, // optional — pre-lowercased
): JiraIssue[] {
  return filteredIssues.filter((issue) => {
    if (cancelledStatuses && cancelledStatuses.has(issue.status.toLowerCase())) return false;
    const entryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;
    return entryDate >= weekStart && entryDate <= weekEnd;
  });
}

// ---------------------------------------------------------------------------
// getKanbanCompletedThisWeek
//
// Returns all issues in the candidate pool that have at least one done-status
// transition whose changedAt falls within [weekStart, weekEnd], regardless of
// when the issue entered the board.
//
// Uses case-insensitive matching against doneStatuses (which must be pre-
// lowercased by the caller).
//
// This is the board-wide throughput "completedCount" — the right semantic for
// kanban (proposal 0066 / ADR 0063).
// ---------------------------------------------------------------------------

export function getKanbanCompletedThisWeek(
  filteredIssues: JiraIssue[],
  statusChangelogsByIssue: Map<string, JiraChangelog[]>,
  doneStatuses: Set<string>, // must be pre-lowercased
  weekStart: Date,
  weekEnd: Date,
): JiraIssue[] {
  return filteredIssues.filter((issue) => {
    const logs = statusChangelogsByIssue.get(issue.key) ?? [];
    return logs.some(
      (cl) =>
        cl.field === 'status' &&
        cl.toValue !== null &&
        doneStatuses.has(cl.toValue.toLowerCase()) &&
        cl.changedAt >= weekStart &&
        cl.changedAt <= weekEnd,
    );
  });
}

// ---------------------------------------------------------------------------
// getKanbanInFlight
//
// Returns all issues in the filtered pool whose current status is neither a
// done status nor a cancelled status. These are issues currently being worked
// on — a board-state snapshot, independent of the week window.
//
// Both doneStatuses and cancelledStatuses must be pre-lowercased by the caller.
// ---------------------------------------------------------------------------

export function getKanbanInFlight(
  filteredIssues: JiraIssue[],
  doneStatuses: Set<string>,      // must be pre-lowercased
  cancelledStatuses: Set<string>, // must be pre-lowercased
): JiraIssue[] {
  return filteredIssues.filter(
    (issue) =>
      !doneStatuses.has(issue.status.toLowerCase()) &&
      !cancelledStatuses.has(issue.status.toLowerCase()),
  );
}
