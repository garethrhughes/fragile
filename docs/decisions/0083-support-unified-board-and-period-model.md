# 0083 — Support report adopts the unified board/period model + time-period mode

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0080-support-unified-periods-remove-ttb-filter.md

## Context

Feature 0022 (ADRs 0079/0080) unified DORA and Cycle Time onto a shared filter model, but
the Support report remained divergent: multi-select board chips (`?boards=`), a
`Quarter | Sprint`-only toggle, and a hand-rolled 90-day default in
`SupportService.resolvePeriod` that ignored the configured timezone. This inconsistency
confused users switching between the four reports.

## Options Considered

### Option A — Keep Support's multi-select board model, add only Time period
- **Summary:** Minimal change; leave `?boards=` multi-select in place.
- **Cons:** Support stays divergent from the other three reports — the opposite of the goal.

### Option B — Adopt the shared single-select + "All" model and add Time period
- **Summary:** Support uses `usePeriodFilter` + `PeriodFilterBar` (single-select board +
  "All", `Quarter | Sprint | Time period`), and `resolvePeriod` routes quarter/window
  through `period-utils.ts` with the configured timezone.
- **Pros:** Identical filtering across all four reports; one shared component/hook.
- **Cons:** Support loses multi-arbitrary board selection (All or one board only).

## Decision

The Support report adopts the shared `usePeriodFilter` hook and `PeriodFilterBar` component:
single-select board with an "All" entry (URL param `boards` → `board`), the identical
`Quarter | Sprint | Time period` toggle, and Sprint gated to a single Scrum board. A new
rolling **Time period** mode (7/30/90 days) is added; `SupportService.resolvePeriod` is
refactored to use `quarterToDates`/`windowToDates` from `period-utils.ts` with
`this.timezone`, so a time-period window ends at 23:59:59.999 of the last full day in the
configured timezone. The `isSprint` / `isCurrentPeriod` / `sprintName` return shape is
preserved (a window is a current period ending yesterday).

## Rationale

Adopting the shared model removes the last divergent report and reuses the tested filter
component/hook, honouring DRY. Routing period resolution through `period-utils.ts` fixes the
Support report's previous timezone omission and aligns it with `MetricsService`.

## Consequences

- **Positive:** Consistent filtering across DORA, Cycle Time, and Support; tz-correct
  Support periods; shared, tested filter UI.
- **Negative / trade-offs:** Support can no longer select an arbitrary subset of boards.
- **Risks:** If multi-arbitrary board selection is later needed for Support, this must be
  revisited (same trade-off as ADR 0079).

## Related Decisions

- [0079](0079-unified-board-and-period-model.md), [0080](0080-time-period-rolling-window-mode.md)
- [0084](0084-support-summary-snapshots.md), [0085](0085-remove-support-ttb-filter.md)
