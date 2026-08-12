# 0084 — Support summary time-period views are snapshotted (summary only)

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0080-support-unified-periods-remove-ttb-filter.md

## Context

The new Support Time period views (ADR 0083) should be pre-computed rather than live on
every request, consistent with the DORA and Cycle Time snapshotting (ADR 0040, ADR 0081).
The Support report had no snapshot infrastructure and exposes both a summary
(`getSupportSummary`) and a potentially very large per-ticket list (`getSupportTickets`).

## Options Considered

### Option A — Live-compute Support time periods (no snapshot)
- **Cons:** Per-request DB load on the default view; inconsistent with ADRs 0040/0081.

### Option B — Snapshot both the summary and the full ticket list per window
- **Cons:** Ticket lists can be thousands of rows × 3 windows × per-board+org — large
  payloads; drill-down would be stale between syncs.

### Option C — Snapshot the summary only; dedicated support_snapshots table
- **Summary:** New `support_snapshots` table (PK `(boardId, snapshotType)`,
  `snapshotType ∈ summary-{7,30,90}d`) + `SupportSnapshotReadService`. Compute the summary
  per window on sync (in-process + Lambda). Ticket list and quarter/sprint stay live.
- **Pros:** Small payloads; fresh drill-down; consistent with ADR 0081's separation.
- **Cons:** New table + migration + Lambda `SupportService` instantiation.

## Decision

The Support **summary** for the three time-period windows is snapshotted on each sync
(per-board + `__org__`) in a dedicated `support_snapshots` table, read via
`SupportSnapshotReadService`; `SupportController.getSupportSummary` serves `window` requests
from the snapshot (202 pending before the first sync). The per-ticket list
(`getSupportTickets`) is **never** snapshotted — it is always live — and quarter/sprint
summaries remain live. The prod Lambda `snapshot.handler` instantiates `SupportService` +
`SprintMembershipService` directly to compute the summary windows.

## Rationale

Snapshotting only the summary keeps payloads small and drill-down fresh while giving the
default (time-period) view fast snapshot-backed reads, matching ADR 0081's scoping for
Cycle Time. A dedicated table keeps the `SupportSummaryDto` payload and staleness semantics
separate from the DORA/cycle-time stores.

## Consequences

- **Positive:** Fast snapshot-backed Support summary; fresh ticket drill-down; separated,
  type-safe store.
- **Negative / trade-offs:** More compute per sync (Support summary × 3 windows × per-board
  + org); the Lambda handler grows to instantiate two more services + two entities.
- **Risks:** If no sync runs for >1 day, the Support time-period summary lags a day
  (surfaced via `X-Snapshot-Age`/stale). Ticket-list time-period reads remain a live
  per-board fan-out (same cost profile as quarter/sprint today).

## Related Decisions

- Extends [0040](0040-lambda-post-sync-dora-snapshot-computation.md),
  [0081](0081-time-period-snapshots.md)
- [0083](0083-support-unified-board-and-period-model.md)
