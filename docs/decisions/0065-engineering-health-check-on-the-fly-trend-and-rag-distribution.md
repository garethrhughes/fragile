# 0065 — Engineering Health Check: On-the-Fly Trend and RAG Distribution

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0071-engineering-health-check-panel.md

## Context

Engineering leadership needs a weekly exec-facing health check for **stability** and
**roadmap delivery**. The Pulse report (`all-items`) already computes per-board
`stabilityScore` and `roadmapAlignmentScore`, but presents them as isolated single-week
ratios with no volume context, no trend, and an org `overallScore` that is a mean of
ratios in which quiet/empty boards contribute 100. Two design questions had to be settled:
how to source the multi-week trend, and how to express org-level health without a single
gameable number. The `all-items` module is explicitly bespoke and deletable (feature
0012), so the solution had to avoid new persistent schema or infrastructure.

## Options Considered

### Option A — On-the-fly trend, RAG distribution, additive response field
- **Summary:** Compute the selected week + 3 prior weeks by reusing the existing per-board
  calculation on each request (completed weeks only); express org health as counts per RAG
  band; deliver via an optional `healthCheck` field on the existing `GET /api/all-items`.
- **Pros:** No schema change, no migration, no new infra; one endpoint/one request; reuses
  the exact existing scoring so numbers are consistent with Pulse; RAG distribution resists
  gaming and cross-team ranking.
- **Cons:** Recomputes prior weeks each request (bounded: 4 weeks × N boards, completed
  weeks only); prior-week numbers can shift retroactively if Jira data is edited.

### Option B — Persisted `HealthCheckSnapshot` entity written post-sync
- **Summary:** Store weekly scores like `DoraSnapshot` and read the trend from storage.
- **Pros:** Fast reads; historically immutable trend.
- **Cons:** Schema change + migration + post-sync/Lambda wiring for a bespoke, deletable
  report; disproportionate cost for v1.

### Option C — Single averaged org health score
- **Summary:** One headline number (mean of per-board overalls).
- **Cons:** Rewards quiet/empty boards; invites cross-team ranking and perverse incentives
  (avoid support tickets, keep boards quiet, over-link to roadmap).

## Decision

We will compute the Health Check trend **on-the-fly** by reusing the existing per-board
calculation for the selected week plus the prior three weeks, band each score into a
**RAG distribution** (`healthy` ≥85, `watch` 70–<85, `at-risk` <70), and return it as an
optional `healthCheck` field on `GET /api/all-items` that is populated **only for completed
(non-current) weeks**.

## Rationale

The `all-items` module is bespoke and deletable, so Option B's persistent schema and infra
were unjustified for v1; on-the-fly reuse keeps the feature fully isolated and read-only.
The RAG distribution (Option A) communicates *where to look* without the gameable headline
number of Option C, directly addressing the exec-reporting misuse risk. Reusing the exact
existing scoring guarantees the Health Check and Pulse never disagree.

## Consequences

- **Positive:** No migration or infra change; consistent with Pulse scores; org view resists
  gaming; completed-week gate avoids presenting half-formed in-progress weeks to execs.
- **Negative / trade-offs:** Per-request recompute of 3 prior weeks (bounded, completed
  weeks only); trend is not an immutable historical record — prior-week scores can change
  if underlying Jira data is edited after the fact.
- **Risks:** If recompute latency becomes material, or an immutable audit trail is required
  for the exec artefact, revisit with Option B (persisted snapshots) via a superseding ADR.

## Related Decisions

- [0062](0062-kanban-stability-score-throughput-balance.md) — Kanban stability score reused
  by the Health Check.
- [0063](0063-kanban-pulse-decouple-completed-from-entry-date.md) — Kanban completed-count
  semantics reused by the Health Check.
- [0040](0040-lambda-post-sync-dora-snapshot-computation.md) — the persisted-snapshot
  pattern (DoraSnapshot) deliberately *not* followed here (Option B rejected).
