# Feature 0007 — Cycle Time Reopen Handling

**Status:** In Progress
**Proposal:** [0054](../proposals/0054-cycle-time-reopen-handling.md)
**ADR:** [0056](../decisions/0056-cycle-time-reopen-handling.md)
**Date:** 2026-05-07

---

## Summary

Replace the inconsistent first-IP/last-Done (and first-IP/first-Done,
and createdAt/first-Done) cycle-pairing logic across four services with
a single shared pure helper `extractCycles` in
`backend/src/metrics/cycle.ts`. Canonical definition: a cycle is
`In Progress → Done` with no intervening reset (where reset = transition
into `boardEntryStatuses` or, where null, a hardcoded fallback). The
representative cycle for aggregation is the last completed cycle. New
`reopenedIssueCount` field on cycle responses surfaces how many issues'
representative is a reopen. `cycle-time.service.ts` returns
`band: null, medianDays: null` when `observations.length === 0` instead
of misclassifying empty data as `'excellent'`. `sprint-detail.service.ts`
gains a new `cycleTimeDays` field alongside the existing `leadTimeDays`
(no rename, no semantic repurpose).

## Acceptance Criteria

The 6 ACs from proposal 0054 §"Acceptance Criteria" apply verbatim.
Additionally:

A. The existing test `cycle-time.service.spec.ts` line 504
   (`'uses the LAST done-transition in period for re-opened issues'`)
   is replaced by a test asserting the **second** In Progress is the
   representative `cycleStart` and the **second** Done is `cycleEnd`.
B. Reset set sourced from `BoardConfig.boardEntryStatuses`; falls back
   to `['To Do', 'Backlog', 'Open', 'Reopened']` when null.
C. New `reopenedIssueCount` plumbed into `CycleTimeResult` (backend) and
   the `pooledPercentiles` reducer in
   `frontend/src/app/cycle-time/page.tsx`; surfaced as a banner using
   the same pattern as the existing anomaly banner (lines 357-368).
D. `sprint-detail.service.ts` retains `leadTimeDays` unchanged and
   adds `cycleTimeDays` via the new helper. No frontend rename.
E. Cross-view integration test asserts cycle-time, support,
   week-detail, and sprint-detail return the same `cycleTimeDays` for
   the same issue/board fixture.
F. No `process.env`, no new dependencies, no `any` casts, weekend
   exclusion via existing `WorkingTimeService.workingDaysBetween`.
G. Structured log line emitted from `cycle-time.service.ts` per
   board/period: `cycle_aggregate_computed boardId=… period=… observations=… reopenedIssueCount=… anomalyCount=…`.

## Out of Scope

- "Rework" view exposing all cycles per issue (reserved for a future
  proposal).
- Removing or renaming `leadTimeDays` on sprint detail.
- Settings UI for editing `boardEntryStatuses` (already exists; this
  feature only consumes it).
- Back-filling cached cycle results — values recompute on next page
  load from cached changelog data.

## Notes

The behaviour change is the visible risk: any board with reopens will
see median cycle time **drop** (the inflated first-IP/last-Done span is
replaced by the second IP/second Done span). The `reopenedIssueCount`
banner makes this explainable. Operators can quantify exposure by
inspecting `JiraChangelog` for issues with multiple `In Progress`
transitions in the analysis window.
