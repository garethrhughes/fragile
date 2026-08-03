# 0074 — Healthcheck is org-wide (pooled), not per-board

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Architect Agent
**Proposal:** docs/proposals/0076-healthcheck-report.md

## Context

ADR 0070 defined the Healthcheck as three scores computed **per board**, with per-board
cards in the UI and per-board results in the API/MCP payload. The requester subsequently
decided they want a single organisation-wide score per dimension (Stability, Roadmap,
Support) that combines all boards — not individual team scores.

## Options Considered

### Aggregation method
- **Option A — Pooled:** sum numerators and denominators across boards, then
  `score = (100 / Σdenominator) * Σnumerator`. Larger boards (more tickets started)
  contribute proportionally more.
- **Option B — Mean of per-board scores:** average each board's percentage. A small board
  and a large board weigh equally.

### Denominator scope
- **Per-dimension:** Stability & Roadmap pool only scrum boards' started tickets (kanban is
  N/A for those two); Support pools all boards' started tickets.
- **Single shared:** all three dimensions use every board's started tickets — dilutes
  Stability/Roadmap since kanban-started tickets can never contribute to their numerators.

## Decision

The Healthcheck is **org-wide**. Each dimension's score is **pooled**:
`score = (100 / Σdenominator) * Σnumerator`, computed with a **per-dimension denominator** —
Stability and Roadmap pool scrum boards only; Support pools all boards. The response exposes
**only** the three org scores (with RAG bands) plus a single 8-week org trend. Per-board
results are removed from the API response, the frontend, and the MCP payload.

## Rationale

Pooling is the most faithful reading of "of all the tickets started, how many were
planned/on-roadmap/support" — it treats every started ticket equally regardless of which
board it belongs to, whereas a mean-of-means would over-weight small boards. Keeping a
per-dimension denominator prevents kanban-started tickets (which can never count toward
Stability/Roadmap) from diluting those two scores. Dropping per-board data matches the
explicit request for a single combined score.

## Consequences

- **Positive:** One clear number per dimension; simpler UI and payload; correct weighting.
- **Negative / trade-offs:** No per-team drill-down (can be reintroduced later if needed).
  A single dominant board can move the org score — acceptable and intended.
- **Risks:** Low. If per-team visibility is wanted again, reintroduce a `boards[]` array
  alongside the org scores without changing the org computation.

## Related Decisions

- Amends ADR 0070 (per-board → org-wide pooled). Retains ADR 0071 (stability sprint
  resolution), ADR 0072 (shared classifySupport), ADR 0073 (RAG bands; roadmap membership).
