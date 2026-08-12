# 0090 — Snapshot subsystem config reconciliation (staleness default, Lambda sizing, org refresh)

**Date:** 2026-08-12
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0084-snapshot-compute-rearchitecture.md

## Context

The snapshot re-architecture (ADR 0088) surfaced several small drifts between code, docs, and
the ADR record: the snapshot staleness fallback was 60 min in code but 2880 min (48h) in
CLAUDE.md/ADR 0040; the Lambda's Terraform sizing/invocation (3008 MB / 300 s /
`RequestResponse`) disagreed with ADR 0040's stale "512 MB / 120 s / Event"; and a board-config
change refreshed the per-board snapshot but not the org rollup that aggregates it.

## Options Considered

### Option A — Leave the drifts
- **Cons:** Code/doc disagreement is a maintenance trap; the stale org snapshot after a config
  edit shows wrong org metrics until the next full sync.

### Option B — Reconcile as part of this change (chosen)
- **Summary:** Align the code staleness fallback to the documented 2880 min; document the real
  Lambda sizing/invocation in Terraform; refresh the org snapshot on board-config change.

## Decision

1. The snapshot read services' staleness fallback is `2880` minutes (48h), matching CLAUDE.md
   and ADR 0040. `SNAPSHOT_STALE_THRESHOLD_MINUTES` still overrides.
2. The Lambda keeps its deployed sizing (3008 MB / 300 s) and synchronous `RequestResponse`
   invocation (SyncService relies on per-board completion ordering before the org rollup); the
   Terraform now documents these values with rationale, correcting the stale ADR 0040 figures.
3. `BoardsService.updateConfig` refreshes **both** the per-board and the org snapshot
   (per-board first so its rows are written before the org rollup reads them), fire-and-forget.

## Rationale

These are correctness/consistency fixes with negligible risk: the staleness change makes code
match long-documented intent; the Terraform comment records reality (no functional infra
change); the org refresh closes a stale-metrics gap after config edits.

## Consequences

- **Positive:** Code and docs agree; org metrics are correct immediately after a config change;
  the Lambda's real sizing is documented.
- **Negative / trade-offs:** A config change now triggers one extra (org) snapshot recompute —
  intended.
- **Risks:** None material.

## Related Decisions

- [0088](0088-single-shared-snapshot-writer.md); refines the record of
  [0040](0040-lambda-post-sync-dora-snapshot-computation.md)
