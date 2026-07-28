# 0067 — Health Check: Per-Team Roadmap Targets & Org Overall Scores

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Infosec Agent
**Proposal:** docs/proposals/0073-health-check-org-scores-and-roadmap-targets.md

## Context

The Engineering Health Check (ADR 0065) reported per-board stability and roadmap-delivery
scores plus a RAG distribution, but had no org-level headline per dimension and graded
roadmap delivery against one global threshold (85/70). Teams have different roadmap
expectations — PLAT targets ~50% (reactive/unplanned work), product teams ~80% — so a
global bar mislabelled PLAT as "at-risk" for meeting its own goal and unfairly dragged any
org average down. We needed org overall scores and target-relative roadmap grading.

## Options Considered

### Option A — Per-team target as banding threshold + attainment denominator
- **Summary:** Store `roadmapDeliveryTarget` per board; roadmap band = healthy ≥ target, watch ≥ target−15, at-risk below; org roadmap = mean of `min(score/target,1)×100`.
- **Pros:** Grades each team against its own bar; org number treats a team hitting its target as 100%; simple to explain.
- **Cons:** Changes what the roadmap RAG distribution means (now relative); one schema field + migration.

### Option B — Target as an arithmetic weight in the average
- **Summary:** Multiply each board's contribution by its target.
- **Cons:** Mathematically opaque, hard to explain, doesn't express "grade each team against its own bar".

### Option C — Raw mean for the org roadmap number
- **Summary:** Org roadmap = simple mean of raw roadmap %s.
- **Cons:** PLAT's legitimate 50% target permanently drags the org number down.

## Decision

We will add a per-board `roadmapDeliveryTarget` (integer %, default 80, PLAT 50) to
`BoardConfig` and use it to (1) grade roadmap RAG bands relative to each team's target
(`classifyRoadmapBand`: healthy ≥ target, watch ≥ target−15, at-risk below) and (2) compute
the org overall roadmap score as the mean of each team's attainment `min(score/target,1)×100`
(capped at 100, null teams excluded). Org overall stability is the simple mean of team
stability scores; stability banding stays fixed at 85/70.

## Rationale

Option A expresses the real intent — "healthy = meeting the target we set for this team" —
without the opacity of weighting (B) or the unfairness of a raw mean (C). Capping attainment
at 100 keeps the org number honest (a team beating its target cannot mask another
underperforming). Storing the target on `BoardConfig` and editing it via the existing
settings UI is consistent with all other per-board rules (ADR 0003).

## Consequences

- **Positive:** Fair per-team grading (PLAT at 40% vs 50% target reads as `watch`, not
  `at-risk`); two exec-friendly org headline numbers; target is runtime-editable per team;
  UI tooltips explain the banding and attainment maths.
- **Negative / trade-offs:** The roadmap RAG distribution is now target-relative, so its
  meaning differs from the fixed-threshold stability distribution; adds one schema column
  and a migration.
- **Risks:** A mis-set target skews a team's banding and the org attainment; mitigated by
  0–100 validation, a sensible default (80), and visible per-team target + tooltips in the
  panel.

## Related Decisions

- [0065](0065-engineering-health-check-on-the-fly-trend-and-rag-distribution.md) — the
  Health Check this extends; org scores and target-relative bands build on its per-board
  scores and distribution.
- [0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) — precedent for per-board
  configurable rules stored in `BoardConfig` and edited via settings.
