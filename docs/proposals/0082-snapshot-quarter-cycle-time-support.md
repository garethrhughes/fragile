# 0082 — Snapshot the quarter (and sprint-independent) views for Cycle Time & Support

**Date:** 2026-08-11
**Status:** Proposed
**Author:** Architect Agent
**Related ADRs:** 0087 (proposed); builds on 0040 (Lambda snapshots), 0079/0081 (time-period snapshots), 0084 (support summary snapshots)

## Problem Statement

Time-period (7/30/90-day) views for DORA, Cycle Time and Support are served from
pre-computed snapshots and load instantly. The **quarter** views are inconsistent:

- **DORA quarter** — already snapshotted (current quarter served from `aggregate`/`trend`
  snapshot; historical quarters computed live + 60s cache).
- **Cycle Time quarter** (aggregate + trend) — **live-computed on every request**.
- **Support quarter** (summary) — **live-computed on every request**.

The live quarter path loads all board issues + their full status changelogs and runs the
weekend-excluded working-time loop (see the perf review). For PLAT (~1,500 issues) this is
slow, and it is the same request-path cost the snapshots were introduced to remove. Users
report the default quarter Cycle Time / Support reports loading slowly while the 90-day view
is instant — precisely because the latter is snapshotted and the former is not.

## Proposed Solution

Extend the existing snapshot mechanism to the quarter views for Cycle Time and Support,
covering **all quarters the UI can request** (the quarter set derived from closed sprints via
`PlanningService.getQuarters`), not just the current one.

### Snapshot types (no new table, no migration — JSONB columns already exist)

- `CycleTimeSnapshotType` gains `aggregate-<quarter>` and `trend-<quarter>` (e.g.
  `aggregate-2026-Q1`).
- `SupportSnapshotType` gains `summary-<quarter>`.

The `<quarter>` suffix (`YYYY-QN`) keeps historical rows distinct from the window rows and
from each other, keyed per board (or `__org__`).

### Writer (in-process + Lambda) — bounded, incremental recompute

For each board (and org):

- Enumerate the quarter set from closed sprints (same source as the UI dropdown).
- **Current quarter:** recompute every sync (it is still changing).
- **Historical (closed/past) quarters:** compute once — skip if a snapshot row already exists
  for that `(board, aggregate-<quarter>)`. Closed-quarter data is immutable, so recomputing it
  every sync would be ~7× wasted work. A `?force` path (or manual re-sync after a backdated
  Jira edit) can refresh if ever needed.

This keeps per-sync cost to roughly the current-quarter computations plus a one-time backfill
of historical quarters on the first sync after deploy.

### Controllers — serve quarter from snapshot

- `GET /api/cycle-time/:boardId?quarter=…` and `/api/cycle-time/trend?mode=quarters` and
  `GET /api/support/summary?quarter=…`: when a `quarter` is supplied (and no `sprintId`), read
  the matching snapshot, returning `202 { status: 'pending' }` if absent and setting
  `X-Snapshot-Stale` / `X-Snapshot-Age` — identical to the existing window branch.
- **Sprint mode stays live** (out of scope — sprint views are not snapshotted for these
  reports today; snapshotting them is a separate change).
- The Support **ticket list** (`GET /api/support`) stays live (ADR 0084 — only the summary is
  snapshotted).

### Out of scope
- Sprint-mode snapshots for Cycle Time / Support.
- Reducing snapshot payload size (the separate P2 finding — `observations[]`/`events[]` bloat).
- The live-path query optimisation (candidate-key narrowing) — orthogonal; the live path is
  still used for sprint mode and historical-quarter backfill.

## Acceptance Criteria

1. Cycle Time aggregate + trend and Support summary for any quarter in the UY dropdown are
   served from a snapshot; the live services are not called on the request path for those.
2. Missing snapshot → `202 { status: 'pending' }`; present → payload + `X-Snapshot-Age`
   (and `X-Snapshot-Stale` when stale), matching the window branch.
3. Sprint mode and the Support ticket list remain live-computed.
4. Writer recomputes the current quarter every sync and computes each historical quarter once
   (skips existing historical rows).
5. Tests: writer persists the new rows (current + historical); controllers serve quarter from
   snapshot, 202 when absent; sprint bypasses.
6. MCP tools that call these endpoints handle the 202-pending contract (cross-check
   `apps/mcp/src/tools/`); bump `apps/mcp/package.json` if any tool changes.

## Risks & Mitigations

- **Stale historical quarter after a backdated Jira edit** — historical snapshots aren't
  recomputed each sync. Rare for closed quarters; mitigated by a force-refresh path / manual
  re-sync. Acceptable trade-off for the ~7× sync-cost saving.
- **First-sync backfill spike** — the initial sync after deploy computes all historical
  quarters once. Mitigated by Lambda offload in prod (ADR 0040); one-time.
- **Snapshot key growth** — one extra row per board per quarter per report. Bounded by the
  number of quarters with closed sprints (currently 8). Negligible.
