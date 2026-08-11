# 0079 — Unified board & period model for DORA and Cycle Time

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0079-unified-reporting-periods-dora-cycle-time.md

## Context

The DORA metrics page and the Cycle Time page exposed divergent filtering: DORA used a
plural `?boards=` multi-select with an "All" chip and a Quarter/Sprint toggle; Cycle Time
used a singular `?board=` single-select with no "All", quarter chips only (no Sprint), plus
an issue-type filter. The two reports behaved differently against the same underlying Jira
data, confusing users switching between them.

## Options Considered

### Option A — Keep DORA multi-board, give Cycle Time single-board
- **Summary:** Leave each page's board model as-is, only add missing controls.
- **Pros:** Smaller diff.
- **Cons:** Pages stay divergent — the opposite of the goal.

### Option B — Unify on single-select board + explicit "All" entry
- **Summary:** Both pages use one board control (single-select with an "All" entry) and an
  identical `Quarter | Sprint | Time period` toggle, backed by a shared URL param schema.
- **Pros:** Identical behaviour; one shared component/hook; simpler mental model.
- **Cons:** DORA loses multi-arbitrary-subset board selection (All or one board only).

### Option C — Wire up the unused `filter-store.ts` Zustand store
- **Summary:** Centralise filter state in the pre-existing store.
- **Cons:** Breaks bookmarkable/shareable report URLs; larger refactor than needed.

## Decision

Both the DORA and Cycle Time pages use a single-select board control with an explicit "All"
entry and an identical `Quarter | Sprint | Time period` toggle, driven by a shared
`usePeriodFilter` hook and `PeriodFilterBar` component. Filter state lives in the URL with a
unified schema: `board`, `mode` (`quarter|sprint|timeperiod`), `quarter`, `sprintId`,
`window`. Sprint is gated to a single Scrum board (via `boards-store` `kanbanBoardIds`).

## Rationale

Unifying on the simpler single-select + "All" model removes the divergence the feature set
out to fix, and URL params keep report links shareable — consistent with the existing
approach on both pages. A shared hook/component is the DRY way to guarantee identical
behaviour rather than duplicating filter JSX per page.

## Consequences

- **Positive:** Identical, predictable filtering across both reports; one place to maintain.
- **Negative / trade-offs:** DORA can no longer select an arbitrary subset of boards (only
  all boards or one board).
- **Risks:** If a future report needs multi-arbitrary board selection, this model must be
  revisited.

## Related Decisions

- [0080](0080-time-period-rolling-window-mode.md), [0081](0081-time-period-snapshots.md),
  [0082](0082-remove-cycle-time-issue-type-filter.md)
