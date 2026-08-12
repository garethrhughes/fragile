# 0089 — Board-level change-scoped snapshot recompute

**Date:** 2026-08-12
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0084-snapshot-compute-rearchitecture.md

## Context

`SyncService.syncAll` recomputed every board's snapshots plus the org rollup (~150 upserts)
on every sync run, regardless of mode. The hourly incremental sync (ADR 0078) therefore paid
the full recompute cost even when it fetched only a handful of changed issues.

## Options Considered

### Option A — Recompute everything every sync (status quo)
- **Cons:** Wasteful on the hourly incremental path; recomputes unchanged boards.

### Option B — Board-level dirty tracking (chosen)
- **Summary:** Recompute only the boards a sync actually changed, plus the org rollup iff any
  board changed.
- **Pros:** Removes the incremental waste; simple and robust.
- **Cons:** Board-level granularity only (a changed board recomputes all its periods).

### Option C — Period-level scoping
- **Cons:** Requires reasoning about which periods a changed issue can affect (an issue's
  changelog can retroactively affect a past window) — risky; deferred.

## Decision

`syncAll` computes a **dirty board set**: a full/daily sync marks every board dirty (deletion/
backlog backstop, ADR 0078); an incremental sync marks a board dirty only if its watermarked
fetch succeeded and wrote something (`issueCount > 0`). Only dirty boards are recomputed
(`invokeSnapshotWorker` per dirty board), and the org snapshot (`invokeOrgSnapshot`) is
recomputed once **iff** at least one board is dirty. When nothing changed, no snapshot
recompute is triggered.

## Rationale

Board-level dirtiness is derivable from the existing per-board `SyncLog` results without
changing `syncBoard`'s contract, and captures the dominant waste (the hourly incremental
recomputing all 6 boards). Full sync remains the backstop for deletions/backlog membership
that an incremental fetch cannot detect.

## Consequences

- **Positive:** Hourly incremental sync recomputes only what changed; large reduction in
  snapshot writes and Lambda invocations on the common path.
- **Negative / trade-offs:** A board with any change recomputes all its periods (windows +
  quarters), not just affected ones — acceptable; period-level scoping deferred.
- **Risks:** If dirtiness detection is wrong (e.g. a change that doesn't bump `issueCount`),
  a board could be skipped. Mitigation: the daily full sync unconditionally recomputes all
  boards, bounding staleness to <24h.

## Related Decisions

- Builds on [0078](0078-incremental-jira-sync.md); [0088](0088-single-shared-snapshot-writer.md)
