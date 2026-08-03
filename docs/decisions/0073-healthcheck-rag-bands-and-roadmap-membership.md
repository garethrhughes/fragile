# 0073 — Healthcheck RAG bands; Roadmap score is membership-based

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Architect Agent
**Proposal:** docs/proposals/0076-healthcheck-report.md

## Context

Healthcheck (ADR 0070) renders three scores that benefit from RAG (red/amber/green) colouring,
and the Roadmap numerator needs a precise definition of "on roadmap". Two decisions are recorded
here: (1) the RAG band thresholds, and (2) that Roadmap is a membership test, not a delivery test.

## Options Considered

### Roadmap definition
- **Option A — Membership (`classifyRoadmapStatus` returns `in-scope` or `linked`):** counts any
  denominator ticket that has a roadmap link.
- **Option B — Delivery (`isDeliveredOnRoadmap`, completion-gated):** the old Pulse behaviour;
  only counts tickets completed on/before the idea target date.

### RAG bands
- Reuse per-board `roadmapDeliveryTarget` (ADR 0067) for the Roadmap score's green threshold;
  fixed bands for Stability and Support.

## Decision

**Roadmap** counts a denominator ticket iff `classifyRoadmapStatus` returns `in-scope` or
`linked` (a roadmap link exists) — a membership test, not delivery. **RAG bands:**

- **Stability** (higher better): green ≥ 80, amber ≥ 60, else red.
- **Roadmap** (higher better): green ≥ `roadmapDeliveryTarget` (default 80, PLAT 50 — ADR 0067),
  amber ≥ 60% of target, else red.
- **Support** (burden — lower better): green ≤ 20, amber ≤ 40, else red.
- N/A (null) scores render as a neutral empty-state, not a colour.

## Rationale

The requester's phrasing "number of these tickets which were on roadmap" is a membership
question, so Option A is correct; the completion gate would under-count in-flight roadmap work.
Reusing `roadmapDeliveryTarget` keeps Healthcheck consistent with existing roadmap targets.
Support is inverted because a high proportion of reactive support is undesirable.

## Consequences

- **Positive:** Roadmap score answers the actual question; bands consistent with ADR 0067.
- **Negative / trade-offs:** Stability/Support thresholds are fixed defaults, not yet per-board
  configurable — acceptable for v1; can be promoted to `BoardConfig` later.
- **Risks:** Threshold values may need tuning after real-world use.

## Related Decisions

- Refines ADR 0070. Reuses `classifyRoadmapStatus` (ADR 0044/0055) and `roadmapDeliveryTarget`
  (ADR 0067). Diverges from the old Pulse `isDeliveredOnRoadmap` usage (superseded by ADR 0070).
