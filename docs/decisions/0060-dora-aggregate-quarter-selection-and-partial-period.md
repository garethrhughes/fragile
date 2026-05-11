# 0060 — DORA Aggregate: Quarter Selection and Partial-Period Awareness

**Date:** 2026-05-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** [docs/proposals/0059-dora-aggregate-quarter-selection-and-partial-period.md](../proposals/0059-dora-aggregate-quarter-selection-and-partial-period.md)

## Context

`GET /api/metrics/dora/aggregate` accepted a `quarter` query parameter but ignored it in
the non-sprint code path. The controller always served the pre-computed snapshot keyed
only by `(boardId, snapshotType)` with no quarter dimension, so any historical quarter
request silently returned the current quarter's data. The MCP `get_dora_metrics` tool was
therefore unreliable for point-in-time scorecards.

Additionally, `deploymentsPerDay` divided by the full quarter length (~90–92 days) even
for an incomplete current quarter, understating the actual rate (e.g. by ~2.4× at the
40-day mark). Consumers had no metadata to detect or correct this.

## Options Considered

### Option A — Serve historical quarters via live compute; add partial-period metadata
- **Summary:** Controller falls through to service layer (which already respects `quarter`)
  for non-current quarters; current quarter continues to use the snapshot fast-path. Three
  metadata fields added to the `period` object: `elapsedDays`, `totalDays`, `partial`.
  `deploymentsPerDay` denominator unchanged (full period).
- **Pros:** No schema migration; leverages existing service-layer caching (60s TTL); backward
  compatible; `deploymentsPerDay` remains cross-period comparable; consumers can annualise.
- **Cons:** Historical queries bypass the snapshot and hit the DB; mitigated by in-memory cache.

### Option B — Store per-quarter snapshots
- **Summary:** Add `quarter` as a third column in `DoraSnapshot` PK; pre-compute historical
  snapshots during sync.
- **Pros:** Zero DB queries for any historical quarter after first sync.
- **Cons:** Requires PK migration + data re-seed; historical data never changes so caching
  gives equivalent performance; over-engineers a rare access pattern.

### Option C — Change `deploymentsPerDay` denominator to `elapsedDays` for current quarter
- **Summary:** Divide by days elapsed rather than full period length when the quarter is incomplete.
- **Pros:** Rate immediately reflects actual pace.
- **Cons:** Non-idempotent (same quarter returns different values over time); breaks
  cross-period comparability in trend charts; consumers cannot reverse an already-annualised
  value.

## Decision

> Use live compute for non-current quarters (Option A), keep the full-period denominator,
> and add `elapsedDays`, `totalDays`, and `partial` to the `period` response object so
> consumers can annotate or annualise at their discretion.

## Rationale

Option A requires no schema change and no migration, since the service layer already
implements correct quarter-scoped queries and the in-memory `DoraCacheService` (60s TTL)
covers repeated access. Keeping the denominator as full period length ensures that
`deploymentsPerDay` remains directly comparable across quarters in trend views. The
partial-period metadata gives consumers the information they need to compute the current
rate themselves, without baking a time-dependent assumption into the stored metric.

## Consequences

- **Positive:** `get_dora_metrics` MCP tool and any frontend caller can now reliably
  request any historical quarter and receive correctly scoped data. Current-quarter stat
  tiles can display "(in progress)" annotations with elapsed/total context.
- **Negative / trade-offs:** Historical quarter requests bypass the snapshot and hit the
  database (mitigated by the 60s in-memory cache on first hit within a request window).
- **Risks:** The `elapsedDays` field is computed at query time using `new Date()`, so
  snapshot payloads written to `DoraSnapshot` for the current quarter will not have
  `partial`/`elapsedDays` recomputed until the snapshot is re-read through the live path.
  This is acceptable: the snapshot is refreshed on every sync; stale snapshots are
  flagged via `X-Snapshot-Stale` header.

## Related Decisions

- [ADR 0040](0040-lambda-post-sync-dora-snapshot-computation.md) — Lambda post-sync DORA snapshot computation (snapshot architecture this builds on)
- [ADR 0042](0042-trend-display-snapshot-type-and-org-merge-strategy.md) — `trend-display` snapshot type and snapshot keying strategy
