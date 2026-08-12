# 0082 — Remove the Cycle Time issue-type filter

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0079-unified-reporting-periods-dora-cycle-time.md

## Context

The Cycle Time page had an issue-type filter (a set of `ToggleChip`s with an "All" option)
backed by a `type` URL param and an `issueType` query param on the cycle-time endpoints.
DORA had no equivalent. As part of unifying the two reports' filtering, the divergent
issue-type filter was removed.

## Options Considered

### Option A — Keep the issue-type filter and add it to DORA too
- **Cons:** Expands scope; DORA metrics (deployment frequency, CFR, MTTR) are not naturally
  issue-type-scoped; adds a filter dimension the brief did not ask for.

### Option B — Remove the issue-type filter from Cycle Time
- **Summary:** Drop the UI control, the `issueType`/`type` params, and the passthrough from
  `MetricsService` to `CycleTimeService`.
- **Pros:** Unifies the two reports; removes an unused-on-DORA dimension.
- **Cons:** Cycle Time can no longer be filtered to a single issue type from the UI.

## Decision

The Cycle Time issue-type filter is removed: the UI control is deleted, `issueType` is
removed from `CycleTimeQueryDto` / `CycleTimeTrendQueryDto` and the frontend cycle-time API
wrappers, and `MetricsService` no longer passes an issue-type filter to `CycleTimeService`.
The `CycleTimeService.calculate` / `getCycleTimeObservations` methods retain their optional
`issueTypeFilter` parameter (unused by callers) as a reusable capability, with their
existing unit tests intact. Because the DTO no longer declares `issueType`, the global
`ValidationPipe` (whitelist) strips any stray `issueType` query param.

## Rationale

The filter existed only on Cycle Time and only made sense there; removing it is the minimal
way to unify the two reports without expanding DORA's dimensions. Keeping the service-level
optional param avoids churning the well-tested `CycleTimeService` while removing the
user-facing surface.

## Consequences

- **Positive:** Consistent filtering across DORA and Cycle Time; simpler Cycle Time page.
- **Negative / trade-offs:** No UI path to filter cycle time by a single issue type.
- **Risks:** If per-issue-type cycle time is needed again, the UI control must be
  reinstated — the service capability still exists to back it.

## Related Decisions

- [0079](0079-unified-board-and-period-model.md)
- Epic/subtask exclusion from metrics ([0018](0018-exclude-epics-and-subtasks-from-metrics.md))
  is unaffected — `isWorkItem` filtering remains.
