# 0072 — Extract shared `classifySupport` used by Support report and Healthcheck

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Architect Agent
**Proposal:** docs/proposals/0076-healthcheck-report.md

## Context

Support classification (support epic OR support label OR TTB support link, per ADR 0045/0047/0061)
is implemented in `support.service` and was separately duplicated inline in the old
`all-items.service.ts`. Healthcheck (ADR 0070) needs the authoritative support signal for its
Support score. Two copies risk divergence.

## Options Considered

### Option A — Extract a pure `classifySupport(issue, links, config)` helper
- **Summary:** Move the classification into `backend/src/support/support-classification.ts`;
  both `support.service` and `healthcheck.service` consume it.
- **Pros:** Single source of truth; testable in isolation; no divergence.
- **Cons:** Small refactor of `support.service` (behaviour-preserving).

### Option B — Re-implement support signals inside Healthcheck
- **Summary:** Copy the logic again.
- **Pros:** No touch to `support.service`.
- **Cons:** Third divergent copy; contradicts the single-source-of-truth intent of ADR 0049-style
  consolidation.

## Decision

Extract a pure `classifySupport` into `backend/src/support/support-classification.ts` and consume
it from both `support.service` and the new `healthcheck.service`. The extraction must preserve
existing support-report behaviour (regression-tested).

## Rationale

Consolidating avoids the exact divergence problem that motivated ADR 0049 for sprint membership.
A pure function is trivially unit-testable and keeps both callers honest.

## Consequences

- **Positive:** One authoritative support classifier; regression-guarded refactor.
- **Negative / trade-offs:** Touches `support.service` — mitigated by regression tests asserting
  identical output.
- **Risks:** Low; behaviour-preserving extraction.

## Related Decisions

- Supports ADR 0070. Preserves ADR 0045/0047/0061 (support classification semantics).
