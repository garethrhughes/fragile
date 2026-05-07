# 0054 — DORA Band Boundary Canonicalisation: `<` for Upper-Bound Bands

**Date:** 2026-05-07
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Reviewer Agent, Infosec Agent
**Proposal:** [0052](../proposals/0052-dora-band-boundary-canonicalisation.md)

## Context

The DORA band classifiers in `backend/src/metrics/dora-bands.ts` and
`frontend/src/lib/dora-bands.ts` historically used inconsistent boundary
operators across the four metrics: Lead Time mixed `<` (Elite) with `<=`
(High/Medium); Change Failure Rate used `<=` throughout; MTTR used `<`
throughout; Deployment Frequency used `>=`. CLAUDE.md spec language is
consistently strict less-than ("Elite = <1 hr", "Elite = <1 day"), but
the code drifted. This produced visible "page contradicts itself"
defects: a Lead Time of exactly 1.0 day classified as `high` while
recommendation rule LT-004 simultaneously fired the elite-LT
recommendation (`<= 1`). Audit identified that the two parallel
classifier files (backend + frontend) had also drifted from each other
once before.

## Options Considered

### Option A — Adopt `<=` everywhere for upper-bound bands
- **Summary:** Treat the boundary value as the *better* band ("LT of exactly 7 days is high").
- **Pros:** Favourable to teams in edge cases.
- **Cons:** Diverges from the published DORA / Forsgren spec; over-rewards measurement-precision artefacts; requires re-writing the operator convention in CLAUDE.md.

### Option B — Document the inconsistency
- **Summary:** Leave the code as-is; document each operator per metric.
- **Pros:** Zero code change.
- **Cons:** Doesn't fix the band/recommendation contradictions; encodes inconsistency permanently; future spec changes have to remember per-metric quirks.

### Option C — `<` strictly less than for all upper-bound bands
- **Summary:** Adopt `<` as the canonical operator for LT, CFR, MTTR; retain `>=` for DF (lower-bound metric, spec uses the `≥` glyph explicitly).
- **Pros:** Matches the published DORA spec and CLAUDE.md wording; eliminates the band/recommendation contradiction; aligns the two parallel classifier files; pure-function change with no schema or API impact.
- **Cons:** A small number of historical sprints will reclassify on next snapshot at boundary values (handful expected).

## Decision

We will use `<` (strict less than) as the canonical operator for all
upper-bound DORA band thresholds (Lead Time, Change Failure Rate, MTTR).
Deployment Frequency retains `>=` because it is a lower-bound metric and
the spec wording uses the `≥` glyph explicitly. We will enforce
cross-suite consistency between `backend/src/metrics/dora-bands.ts` and
`frontend/src/lib/dora-bands.ts` via a shared boundary fixture at
`docs/dora-bands-fixture.json` consumed by both Jest and Vitest suites.

## Rationale

Option C aligns the code with the published DORA bands (Forsgren et al.)
and matches the spec language already in CLAUDE.md. It eliminates the
class of bug where a sprint's band display contradicts its recommendation
text on the same page. The shared JSON fixture pattern is the only
practical guard against future drift between the two parallel classifier
files — frontend cannot import from backend without introducing a shared
package, which is disproportionate for ~30 lines of pure-function code.
The fixture keeps the two implementations honest with zero runtime
coupling.

## Consequences

- **Positive:**
  - Band display and recommendation text are now consistent at every boundary value.
  - The shared fixture makes any future drift between backend and frontend impossible to ship — both suites would fail.
  - Operator convention is now uniform: `<` for upper-bound, `>=` for lower-bound, derived from the spec direction of the metric.
  - Recommendation rules (LT-001..004, CFR-001..004) now form a clean partition of the real line with no overlap or gap — easier to reason about.
- **Negative / trade-offs:**
  - Boards that have historically reported boundary values (LT exactly 7 or 30 days; CFR exactly 5%, 10%, 15%) will reclassify down one band on next snapshot.
  - Two parallel classifier files remain — the fixture mitigates drift but does not eliminate the duplication. A future shared package would remove the duplication entirely.
- **Risks:**
  - If a contributor adds a new DORA metric or a new band threshold without updating the fixture, the contract guard is bypassed. Mitigated by both suites loading the fixture eagerly — empty/missing fixture causes immediate test failure.

## Related Decisions

- [ADR 0024](0024-weekend-days-excluded-from-cycle-time.md) — Weekend exclusion in Lead Time / Cycle Time (orthogonal calculation choice)
- [ADR 0025](0025-mttr-uses-calendar-hours.md) — MTTR uses calendar hours (orthogonal calculation choice)
- [ADR 0040](0040-lambda-dora-snapshot-computation.md) — Stale `dora_snapshots` rows refresh on next sync via `(boardId, snapshotType)` PK overwrite, so no migration is required for the boundary reclassification.
