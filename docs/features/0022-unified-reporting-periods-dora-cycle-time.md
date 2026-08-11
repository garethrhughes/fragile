# 0022 — Unified Reporting Periods for DORA & Cycle Time

**Date:** 2026-08-11
**Status:** In Progress
**Source:** Manual
**Related proposal:** docs/proposals/0079-unified-reporting-periods-dora-cycle-time.md

## Summary

Unify the reporting-period filtering UI and logic across the DORA metrics and Cycle Time
pages, and introduce a new "Time period" rolling-window option (Last 90 / 30 / 7 days)
alongside the existing Quarter and Sprint modes.

## Background / Motivation

The DORA metrics page and the Cycle Time page currently expose divergent filtering:

- DORA uses a `?boards=` (plural) param with multi-select + an "All" chip, and a
  Quarter/Sprint period toggle (no explicit quarter/sprint dropdowns — quarter is implicit
  as the current quarter; sprint mode shows "last 8 sprints").
- Cycle Time uses a `?board=` (singular) param with single-board select and **no** "All"
  option, quarter chips only (no Sprint mode), and an **issue type filter**.

This inconsistency makes the two reports behave differently for the same underlying data
and confuses users switching between them. There is also no way to view either report over
a simple rolling window (e.g. "last 30 days") independent of quarter/sprint boundaries.

## Scope

**In scope**

- A single, shared filtering model used by both the DORA and Cycle Time pages:
  - Board selection: **single-select with an explicit "All" entry** on both pages.
  - Period toggle group with three options: **Quarter | Sprint | Time period**.
    - Quarter → dropdown to choose which quarter.
    - Sprint → dropdown to choose which sprint (only when a single Scrum board is selected).
    - Time period → dropdown offering **Last 90 days / Last 30 days / Last 7 days**.
- Sprint mode/dropdown gated to a single Scrum board (disabled for Kanban / "All").
- Removal of the issue type filter from the Cycle Time page (and its API surface).
- Time-period trend chart shows rolling buckets across the selected window:
  - Last 7 days → daily buckets
  - Last 30 days → daily buckets
  - Last 90 days → weekly buckets
- Time-period windows end at the **last full day** in the configured timezone (i.e. up to
  23:59:59 yesterday), computed using the existing timezone configuration.
- Time-period aggregates and trends are **snapshotted** (pre-computed, recomputed on each
  Jira sync) for both DORA and Cycle Time.
- Default selected period on first load (no URL params): **Time period → Last 90 days**.

**Out of scope**

- Changes to any other report page (planning, roadmap, sprint-report, quarter, week, gaps).
- Changes to DORA band boundaries, cycle-time calculation semantics, or weekend handling.
- Persisting filter state to a store/back-end; URL params remain the state mechanism.
- Kanban sprint support (Kanban continues to have no sprint mode).

## Acceptance Criteria

- Given either the DORA or Cycle Time page, when it loads with no URL params, then the
  Time period toggle is selected with "Last 90 days" and metrics render for that window.
- Given either page, when I open the period toggle, then I see exactly three options:
  Quarter, Sprint, Time period — identical on both pages.
- Given the Quarter toggle is selected, when I open its dropdown, then I can pick any
  available quarter and the metrics + trend update for that quarter.
- Given the Sprint toggle, when a single Scrum board is selected, then the Sprint option is
  enabled and its dropdown lists that board's sprints; when "All" or a Kanban board is
  selected, then the Sprint option is disabled with an explanatory hint.
- Given the Time period toggle, when I choose Last 7 / 30 / 90 days, then the metrics
  compute over that rolling window and the trend chart shows daily buckets (7d, 30d) or
  weekly buckets (90d).
- Given the Cycle Time page, then there is no issue type filter control anywhere on it.
- Given either page, then a single-select board control with an explicit "All" entry is
  present and behaves identically on both.

## Open Questions

None.

## Notes

- Backend `resolvePeriod` (`metrics.service.ts`) already parses an explicit
  `period=YYYY-MM-DD:YYYY-MM-DD` range and defaults to last-90-days; the Time period option
  can map to a computed range or a dedicated field. `DoraAggregateQueryDto`/`DoraTrendQueryDto`
  do not currently accept `period` and will need it.
- Existing unused building blocks: `frontend/src/components/ui/quarter-select.tsx` and
  `sprint-select.tsx` (dropdowns) and `frontend/src/store/filter-store.ts` (an unused
  unified filter shape) may be reused.
- Board type (scrum vs kanban) source of truth is `boards-store.ts` `kanbanBoardIds`.
