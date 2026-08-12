# 0081 — Time-period views are snapshotted; dedicated cycle_time_snapshots store

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0079-unified-reporting-periods-dora-cycle-time.md

## Context

Time-period (rolling-window) DORA and Cycle Time views must be pre-computed rather than
computed live on every request, consistent with the DORA snapshot approach (ADR 0040). DORA
already has a `dora_snapshots` table and a post-sync compute pipeline; Cycle Time had **no**
snapshot infrastructure at all (always live-computed).

## Options Considered

### Option A — Live-compute time periods (no snapshots)
- **Cons:** Per-request DB load on the most-used default view (90-day); inconsistent with
  ADR 0040. Rejected by the feature brief.

### Option B — Reuse `dora_snapshots` for Cycle Time windows
- **Cons:** Cycle-time payload shape differs from `OrgDoraResult`; overloading a
  DORA-named table with unrelated data muddies the read services and staleness semantics.

### Option C — Snapshot both; dedicated `cycle_time_snapshots` table
- **Summary:** Extend `DoraSnapshotType` with window-suffixed types and add a parallel
  `cycle_time_snapshots` table + read service, mirroring the DORA pattern.
- **Pros:** Type-safe read paths; concerns separated; consistent with ADR 0040.
- **Cons:** New entity + migration + compute wiring in two places (in-process + Lambda).

## Decision

Time-period aggregates and trends are snapshotted for both DORA and Cycle Time, recomputed
on each Jira sync (the existing `computeBoard`/`computeOrg` hook, per-board then org).
`DoraSnapshotType` is extended with `aggregate-7d/30d/90d` and `trend-7d/30d/90d` (stored in
the existing `dora_snapshots` varchar-keyed table — no migration needed). A new
`cycle_time_snapshots` table (composite PK `(boardId, snapshotType)`, reversible migration)
plus `CycleTimeSnapshotReadService` mirror the DORA store for the six cycle-time window
rows. Controllers route `mode=timeperiod` / `window` to the corresponding snapshot; a 202
"pending" response is returned before the first sync computes them. Only the three
time-period windows are snapshotted for Cycle Time — quarter and sprint cycle-time views
remain live-computed.

## Rationale

Recomputing on sync keeps reads fast and consistent with ADR 0040; because windows end at
"yesterday", each daily sync rolls the window forward naturally (a missed sync lags at most
one day, surfaced via the existing `X-Snapshot-Age`/stale metadata). A dedicated table
keeps the cycle-time payload shape and staleness semantics cleanly separated from DORA.

## Consequences

- **Positive:** Fast snapshot-backed reads for the default view; type-safe, separated stores.
- **Negative / trade-offs:** More compute per sync (3 windows × aggregate+trend × per-board
  + org, for both DORA and Cycle Time); new table + migration to maintain.
- **Risks:** If no sync runs for >1 day, time-period snapshots lag by a day until the next
  sync. Snapshot staleness threshold (`SNAPSHOT_STALE_THRESHOLD_MINUTES`) governs the
  surfaced warning.

## Related Decisions

- [0079](0079-unified-board-and-period-model.md), [0080](0080-time-period-rolling-window-mode.md)
- Extends [0040](0040-lambda-post-sync-dora-snapshot-computation.md) snapshot-on-sync model.
