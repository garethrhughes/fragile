# 0004 — Sprint Report Scoring: N/A Handling and Weight Renormalisation

**Date:** 2026-05-07
**Status:** Implemented
**Source:** Manual (driven by proposal 0051)
**Related proposal:** docs/proposals/0051-sprint-report-scoring-na-handling.md
**Related decision:** docs/decisions/0053-sprint-report-na-handling-and-weight-renormalisation.md (to be written)

## Summary

Replace coercion-based DORA defaults and neutral-50 fallbacks in the sprint
report scoring pipeline with explicit `null` propagation, then renormalise the
composite weights across only the dimensions that actually have data. Surface
the per-dimension presence (`contributingDimensions`, `excludedDimensions`,
`totalWeightApplied`) on the API response and reflect it in the frontend with
an "Insufficient data" state and a `~` modifier when the score is computed
from a partial weight set. Update the MCP package in lockstep with a minor
version bump.

## Background / Motivation

`backend/src/sprint-report/sprint-report.service.ts` (lines 184–188) coerces
missing DORA values to band-classifiable defaults using `??`:
- `deploymentsPerDay ?? 0` → `low` band
- `medianLeadTimeDays ?? 9999` → `low` band
- `changeFailureRate ?? 0` → `elite` band
- `medianMttrHours ?? 0` → `elite` band

`backend/src/sprint-report/scoring.service.ts` (lines 130, 139, 148) then
returns a neutral `50` when the denominator for delivery-rate, scope-stability,
or roadmap-coverage is zero.

The combined effect is asymmetric and misleading — a sprint with no signal at
all still produces a composite ≥ 50/100 because missing CFR/MTTR data is
flattering (elite-by-default) while missing Lead Time penalises the team
(low-by-default). Teams are reading noise on retros.

## Scope

**In scope**
- Change each scorer in `ScoringService` to return
  `{ score: number; weight: number } | null` (null when the input is `null`
  or when the denominator is `0`).
- Change the composite calculation to filter nulls, sum survivor weights, and
  return `null` if no survivors; otherwise `Σ score × weight ÷ Σ weight`.
- Remove the `?? 0` / `?? 9999` coercions in `SprintReportService`. Pass
  `null` through end-to-end.
- Extend the API response with `excludedDimensions: ScoreDimension[]`,
  `contributingDimensions: ScoreDimension[]`, `totalWeightApplied: number`.
- Make the `SprintReport.compositeScore` and `compositeBand` columns
  nullable + add a TypeORM migration.
- Frontend: render "Insufficient data" when `compositeScore === null`;
  prefix the score with `~` when `totalWeightApplied < 1` (with a tooltip
  listing the excluded dimensions); render trend-chart gaps for null
  composites.
- MCP: minor version bump (`1.0.3 → 1.1.0`); update tool description so
  callers know `compositeScore` may be `null`.
- Add a structured log line per sprint report including
  `excludedDimensions` (per Impact Assessment row in proposal 0051).

**Out of scope**
- Recomputing or back-filling cached `SprintReport` rows. New reports get
  the new shape; existing rows continue to surface their cached payload
  until Jira sync regenerates them on demand.
- ADR write-up (the decision-log skill will handle ADR 0053 separately).

## ScoreDimension enum

A new exported string-union type used for the `contributingDimensions` and
`excludedDimensions` arrays:

```typescript
export type ScoreDimension =
  | 'deliveryRate'
  | 'scopeStability'
  | 'roadmapCoverage'
  | 'leadTime'
  | 'deploymentFrequency'
  | 'changeFailureRate'
  | 'mttr';
```

Order in arrays mirrors the canonical display order on the dimension grid.

## Composite weights (unchanged set, renormalised denominator)

| Dimension | Weight |
|---|---|
| deliveryRate | 0.25 |
| scopeStability | 0.15 |
| roadmapCoverage | 0.10 |
| leadTime | 0.20 |
| deploymentFrequency | 0.10 |
| changeFailureRate | 0.10 |
| mttr | 0.10 |

`totalWeightApplied` = sum of weights of contributing dimensions
(0.0 ≤ x ≤ 1.0). UI shows the `~` modifier when `< 1.0`.

## UI design call — `~` modifier placement

The modifier is rendered as a leading character on the composite number
(e.g. `~62.5`) using the same colour as the band. Hovering the number
reveals a tooltip listing the excluded dimension labels. This was chosen
over a trailing modifier because the leading position reads naturally as
"approximately" in the same way scientific notation does, and avoids
visual collision with the band label that already follows the score.

## Acceptance Criteria

(Verbatim from proposal 0051 with the field-name correction `composite →
compositeScore`.)

- **AC1:** `SprintReportService.getReport` returns
  `compositeScore: number | null`,
  `contributingDimensions: ScoreDimension[]`,
  `excludedDimensions: ScoreDimension[]`, `totalWeightApplied: number`.
  → covered by `sprint-report.service.spec.ts` "returns excludedDimensions
  listing every N/A dimension", "returns contributingDimensions listing
  every dimension with data", "totalWeightApplied equals 1.0 …",
  "totalWeightApplied equals 0.25 when only Delivery Rate is available".
- **AC2:** `ScoringService.scoreDeliveryRate`, `scoreScopeStability`,
  `scoreRoadmapCoverage` return `null` (not 50) when their denominator
  is 0.
  → covered by `scoring.service.spec.ts` "returns null (not 50) when
  delivery rate denominator is 0" (× 3 dimensions).
- **AC3:** `SprintReportService` no longer applies `?? 0` or `?? 9999`
  defaults; missing DORA values propagate as `null` end-to-end.
  → covered by `sprint-report.service.spec.ts` "does not coerce missing
  DORA values to 0 or 9999".
- **AC4:** A unit test asserts: a sprint with only Delivery Rate available
  produces `totalWeightApplied = 0.25`, composite = the Delivery Rate
  score (renormalised to 100% weight).
  → covered by `scoring.service.spec.ts` "returns the single non-null
  score (renormalised to 100% weight) when only one dimension has data"
  and `sprint-report.service.spec.ts` "totalWeightApplied equals 0.25
  when only Delivery Rate is available".
- **AC5:** A unit test asserts: a sprint with no data in any dimension
  produces `compositeScore = null`.
  → covered by `scoring.service.spec.ts` "returns null composite when
  all dimensions are null".
- **AC6:** Frontend `SprintReportScoreCard` renders "Insufficient data"
  when `compositeScore === null` and renders a `~` modifier when
  `totalWeightApplied < 1`.
  → covered by frontend Vitest test in `frontend/src/app/sprint-report/
  composite-display.test.tsx`.
- **AC7:** ADR 0053 documents the renormalisation formula and the
  explicit choice to fail open per-dimension rather than fail closed.
  → out of scope for this feature commit; handled by decision-log skill.

## Implementation Order

1. **Backend tests (RED)** — extend `scoring.service.spec.ts` and create
   `sprint-report.service.spec.ts` with the new fixtures.
2. **Backend implementation (GREEN)** —
   1. `scoring.service.ts`: change scorer signatures, composite formula,
      add `compositeScore: number | null`, `contributingDimensions`,
      `excludedDimensions`, `totalWeightApplied` on `CompositeResult`.
   2. `sprint-report.service.ts`: drop the coercions; thread the new
      response fields through; structured log line.
   3. Migration: make `composite_score` and `composite_band` nullable on
      `sprint_reports`; entity update.
3. **Frontend (GREEN)** —
   1. `lib/api.ts`: nullable types + new fields.
   2. `page.tsx`: composite-display block + trend-chart gaps.
   3. Vitest test for the composite-display behaviour.
4. **MCP (GREEN)** —
   1. Update tool description; bump package version.

## Test Strategy

| Fixture | Purpose |
|---|---|
| All-data | All seven dimensions present → `totalWeightApplied = 1.0`, `excludedDimensions = []`. |
| Partial-data | DORA missing only → renormalise to 0.50 weight base, `excludedDimensions` lists the four DORA dimensions. |
| No-data | All dimensions null → `compositeScore = null`, `compositeBand = null`, `totalWeightApplied = 0`. |
| Only-Delivery-Rate | Only delivery present (committed > 0) → `totalWeightApplied = 0.25`, composite = deliveryRate.score. |

## Notes

- No new dependencies.
- Migration follows the established pattern (raw `ALTER TABLE` SQL with both `up()` and `down()`).
- The `SprintReport` cache is not back-filled; the next sync invalidation
  will let it re-populate organically (consistent with how the
  `unplannedDone` field was rolled out).
- Branch: continues from `feature/0001-support-detection-epic-matching`.
