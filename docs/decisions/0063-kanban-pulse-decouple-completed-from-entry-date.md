# 0063 — Kanban Pulse Report: Decouple Completed Count from Working Set Entry Date

**Date:** 2026-05-15
**Status:** Accepted
**Deciders:** Architect Agent
**Proposal:** [0065 — Kanban Pulse Report: Decouple Completed Count from Working Set Entry Date](../proposals/0065-kanban-pulse-decouple-completed-from-entry-date.md)

## Context

The pulse report (All Items Weekly Report) defines the kanban working set as "issues whose
board-entry date falls within the selected week". The `completedCount` summary field was
computed by counting `completed = true` flags within that working set — meaning only items
that both entered the board AND transitioned to Done within the **same calendar week** were
counted as completions.

For any kanban team with realistic cycle times (days to weeks), this systematically
under-counted completions. Items that entered the board in a prior week and completed this
week were invisible. In practice, `completedCount ≈ 0` for most weeks on PLAT, which
cascaded into:
- `stabilityScore` (ADR 0062) permanently near 0%
- `roadmapAlignmentScore` defaulting to 100% (no-signal fallback) even when misalignment existed

## Decision

For kanban boards, `completedCount` and `onRoadmapCount` in `AllItemsBoardSummary` are now
computed by scanning **all board issues** for done-transitions within the week window —
independent of the board-entry working set filter.

- `totalItems` remains "issues that entered the board this week" (the stability formula
  denominator — unchanged)
- `completedCount` is now "all board issues that transitioned to Done this week" (the
  stability formula numerator and the roadmap alignment denominator)
- `onRoadmapCount` is computed over the same board-wide completion set

For scrum boards, both fields remain derived from the sprint-membership working set only
(unchanged).

### Implementation

After building the kanban working set and items array, a separate loop iterates
`allBoardIssues` (already in memory) and calls `detectCompletionDate` for each. No
additional database queries are introduced — the changelogs are already loaded into
`statusChangelogsByIssue`.

The override is applied to the `summary` object before `calculateHealthScore` is called.

## Consequences

- Kanban boards now report meaningful `completedCount` reflecting actual weekly throughput
- `stabilityScore` (ADR 0062) now reflects real throughput balance
- `roadmapAlignmentScore` now correctly measures alignment for kanban teams
- The `items[]` array in the response still only contains working-set items (entered this
  week) — individual item `completed` flags are not affected
- `summary.completedCount` can now exceed `summary.totalItems` for kanban boards (e.g. 3
  items entered, 5 completed from prior weeks) — this is correct and handled by the
  `Math.min` cap in the stability formula
- No schema change, no API contract change (same field, same type), no new DB queries
