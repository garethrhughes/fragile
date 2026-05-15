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
// Applies the standard kanban candidate-pool filters:
//   1. inBacklog — exclude issues the Jira Agile backlog API reports as in
//      the backlog. This is the authoritative board/backlog discriminator
//      (ADR 0067) — replaces the previous backlogStatusIds/changelog heuristics.
//   2. dataStartBound — exclude issues whose board-entry date predates the
//      configured data start date.
//
// Returns the filtered array ("on-board issues"). This is the pool used for
// completion scanning, in-flight detection, and week-window filtering.
// ---------------------------------------------------------------------------

export interface FilterKanbanIssuesArgs {
  issues: JiraIssue[];
  dataStartBound: Date | null;
  boardEntryDateByKey: Map<string, Date>;
}

export function filterKanbanIssues({
  issues,
  dataStartBound,
  boardEntryDateByKey,
}: FilterKanbanIssuesArgs): JiraIssue[] {
  return issues.filter((issue) => {
    // 1. Backlog exclusion — authoritative via Jira Agile backlog API (ADR 0067)
    if (issue.inBacklog) return false;

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
    // Issue must currently be in a done status. An issue that passed through
    // a done status then moved to something else (e.g. Done → Scheduled) is
    // not complete — it should not be counted.
    if (!doneStatuses.has(issue.status.toLowerCase())) return false;

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
// Returns all issues in the filtered pool that are currently being worked on:
//   - entered the board BEFORE this week (not the "pulled in" set)
//   - not in a done status
//   - not in a cancelled status
//
// "Pulled in" issues (boardEntryDate >= weekStart) are explicitly excluded —
// those belong to the Pulled In count, not In Flight.
//
// All status sets must be pre-lowercased by the caller.
// ---------------------------------------------------------------------------

export function getKanbanInFlight(
  filteredIssues: JiraIssue[],
  doneStatuses: Set<string>,         // must be pre-lowercased
  cancelledStatuses: Set<string>,    // must be pre-lowercased
  boardEntryDateByKey: Map<string, Date>,
  weekStart: Date,
  weekEnd: Date,
): JiraIssue[] {
  return filteredIssues.filter((issue) => {
    if (doneStatuses.has(issue.status.toLowerCase())) return false;
    if (cancelledStatuses.has(issue.status.toLowerCase())) return false;
    // Exclude issues that entered this week — those are "Pulled In"
    const entryDate = boardEntryDateByKey.get(issue.key) ?? issue.createdAt;
    return entryDate < weekStart;
  });
}
