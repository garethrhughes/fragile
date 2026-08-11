# 0023 — Unified reporting periods for the Support report; remove TTB-linked filter

**Date:** 2026-08-11
**Status:** In Progress
**Source:** Manual
**Related proposal:** docs/proposals/0080-support-unified-periods-remove-ttb-filter.md

## Summary

Extend the unified reporting-period filtering introduced in feature 0022 (DORA & Cycle
Time) to the **Support report**, adding the rolling **Time period** mode (last 7/30/90
days) and switching to the shared single-select board + "All" model. Separately, remove the
**"TTB-linked only"** filter from the Support report.

## Background / Motivation

Feature 0022 unified DORA and Cycle Time onto a shared `PeriodFilterBar` + `usePeriodFilter`
model (single-select board + "All"; `Quarter | Sprint | Time period` toggle; tz-correct
rolling windows; snapshotted time-period views). The Support report was left on its own
bespoke filtering: multi-select board chips (`?boards=`), only a `Quarter | Sprint` toggle
(no time period), a hand-rolled last-90-days default with no timezone, and an extra
**"TTB-linked only"** toggle (`?matchReason=link`). This inconsistency confuses users moving
between reports, and the TTB-linked filter is no longer wanted.

## Scope

**In scope**

- Support report adopts the shared `usePeriodFilter` hook and `PeriodFilterBar` component:
  - single-select board control with an explicit "All" entry
  - `Quarter | Sprint | Time period` toggle (identical to the other reports)
  - Sprint gated to a single Scrum board (Kanban keeps Quarter + Time period, no Sprint)
- New **Time period** mode (last 7/30/90 days) on Support, using the same
  `windowToDates` / `listRollingBuckets` tz-correct semantics as feature 0022 (window ends
  at 23:59:59.999 of the last full day in the configured timezone).
- Support backend `resolvePeriod` refactored to reuse `period-utils.ts` (quarter/window
  with timezone) while preserving its `isSprint` / `isCurrentPeriod` / `sprintName`
  downstream semantics (esp. the Kanban board-entry filtering).
- Support **summary** (`getSupportSummary`) for the three time-period windows is
  **snapshotted on sync** (per-board + org), mirroring feature 0022. A new
  `support_snapshots` store + read service + compute wiring (in-process and Lambda).
- Support URL board param migrates `boards` (CSV multi-select) → `board` (single or "All").
- Remove the **"TTB-linked only"** filter: the UI toggle, the `matchReason` URL param /
  state / fetch dependency, the `matchReason` field on the frontend Support query params
  and both wrappers, the `matchReason` field on the backend `SupportQueryDto`, and its
  application in `SupportService`.

**Out of scope**

- The per-ticket list (`getSupportTickets`) is **not** snapshotted — it stays
  live-computed (drill-down is always fresh). Quarter and sprint Support views also stay
  live-computed (only the three time-period windows are snapshotted).
- The ticket table's **"Match" column** (which displays each ticket's classification —
  link/label/epic) is **kept**.
- The MCP support tool's `matchReason` parameter (`apps/mcp/src/tools/support.ts`) is
  **kept** — only the dashboard UI filter is removed.
- No change to Support classification logic (`support-classification.ts`), the triage
  board (`triageBoardKey`) concept, or the CFR/other reports.

## Acceptance Criteria

- Given the Support page loads with no URL params, then it shows the shared filter bar with
  Time period selected and "Last 90 days" chosen, board = All, and renders the summary.
- Given the Support page, when I open the period toggle, then I see exactly three options
  (Quarter, Sprint, Time period) — identical to the DORA and Cycle Time pages.
- Given a single Scrum board is selected, then Sprint is enabled; given "All" or a Kanban
  board is selected, then Sprint is disabled with the shared hint.
- Given Time period → Last 7/30/90 days, then Support metrics cover that rolling window
  (ending 23:59:59 yesterday in the configured timezone).
- Given a sync has run, then `support_snapshots` contains a summary row for
  `summary-7d/30d/90d` for each board and for `__org__`; `GET /api/support/summary?window=30`
  is served from the `summary-30d` snapshot (or 202 pending before the first sync).
- Given the Support page, then there is no "TTB-linked only" toggle anywhere on it.
- Given `GET /api/support` or `GET /api/support/summary`, then a `matchReason` query param
  is no longer accepted or applied (stripped by the global ValidationPipe whitelist).
- Given the Support ticket table, then the "Match" column still displays each ticket's
  classification.
- Given the MCP support tool, then its `matchReason` parameter continues to work unchanged.

## Open Questions

None.

## Notes

- Support's `resolvePeriod` (`support.service.ts`) currently hand-rolls the 90-day default
  with no timezone; the refactor should route quarter/window through `period-utils.ts`
  with `this.timezone`, matching `MetricsService.resolvePeriod`.
- `resolveBoardIds` in `support.service.ts` already CSV-splits `boardId`, so the shared
  hook's `boardIdForApi` (single board, or undefined = all) is compatible; "All" maps to
  the all-boards path.
- Backend TTB tests to update: `support.service.spec.ts` matchReason-filter tests
  (`returns only link-matched tickets`, `includes tickets with combined reasons`,
  `matchReason filter absent`). Classifier tests (`support-classification.spec.ts`) and the
  `isTtbSupport`/Match-column behaviour are unaffected.
