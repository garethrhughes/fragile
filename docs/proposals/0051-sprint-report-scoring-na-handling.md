# 0051 — Sprint Report Scoring: N/A Handling and Weight Renormalisation

**Date:** 2026-05-06
**Status:** Draft
**Author:** Architect Agent
**Related ADRs:** —
**Related Proposals:** [0022](0022-sprint-report.md)

---

## Problem Statement

`backend/src/sprint-report/sprint-report.service.ts` lines 184–188 coerce
missing DORA metrics into band-classifiable values using `??` defaults:

```typescript
deploymentsPerDay: dora.deploymentsPerDay ?? 0,         // → low
medianLeadTimeDays: dora.medianLeadTimeDays ?? 9999,    // → low
changeFailureRate: dora.changeFailureRate ?? 0,         // → elite
medianMttrHours: dora.medianMttrHours ?? 0,             // → elite
```

`backend/src/sprint-report/scoring.service.ts` lines 130, 139, 148 then
fall back to a neutral `50` for `scoreDeliveryRate`, `scoreScopeStability`,
and `scoreRoadmapCoverage` when their input is `null` or their denominator
is `0`.

Combined effect — a sprint with no incidents and no completions
**still receives a composite score** because:

- CFR = 0 (no failures detected) → `elite` band → score 100 with weight 15%
- MTTR = 0 (no incidents detected) → `elite` band → score 100 with weight 10%
- Three `?? 50` fallbacks contribute another 25 + 15 + 10 = 50% × 50 = 25 points

A sprint with literally no signal therefore scores ≥ 50/100 instead of
the correct "not enough data". Teams using the score for retro
discussions are reading noise.

This is also asymmetric: missing CFR/MTTR data **flatters** the team
(elite score by default), missing Lead Time **penalises** the team
(`?? 9999` → low band). Neither is correct.

---

## Proposed Solution

Replace coercion with explicit N/A propagation, then renormalise weights
across only the dimensions that have data.

### Phase 1 — Make N/A a first-class value

Change all DORA-derived fields in `SprintReportService` to remain
`number | null`. Each scorer in `ScoringService` returns
`{ score: number; weight: number } | null` where `null` means
"insufficient data — exclude from composite".

### Phase 2 — Weight renormalisation

The composite score becomes:

```typescript
const contributing = scores.filter((s): s is NonNull => s !== null);
const totalWeight = contributing.reduce((sum, s) => sum + s.weight, 0);
const composite = totalWeight > 0
  ? contributing.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight
  : null;  // NO data at all → composite is null
```

Result: a sprint with only Delivery Rate available scores on
Delivery Rate alone (weight 25% → renormalised to 100%). A sprint
with literally no signal returns `composite = null` and the UI shows
"Insufficient data" rather than a misleading number.

### Phase 3 — Surface N/A dimensions in the response

Extend the API response with a per-dimension presence flag:

```typescript
interface SprintReportScore {
  composite: number | null;
  contributingDimensions: ScoreDimension[];   // dimensions with data
  excludedDimensions: ScoreDimension[];       // dimensions excluded as N/A
  totalWeightApplied: number;                 // 0..1; UI shows when < 1
}
```

The frontend shows a `~` indicator next to scores where
`totalWeightApplied < 1`, with hover-text explaining which dimensions
were excluded.

### Data flow

```mermaid
flowchart LR
    A[DORA result] --> B{value present?}
    B -->|no| C[null]
    B -->|yes| D[band score 0-100]
    C --> E[ScoringService]
    D --> E
    E --> F{scores.filter(non-null)}
    F -->|empty| G[composite = null<br/>UI: 'Insufficient data']
    F -->|non-empty| H[Renormalise weights]
    H --> I[composite = Σ score×w / Σ w]
    I --> J[Response includes contributing<br/>+ excluded dimension lists]
```

---

## Alternatives Considered

### Alternative A — Keep neutral 50, document it

Document that "no data" scores 50 and instruct users to interpret
composite scores between 40 and 60 with caution.

Ruled out because:
- Reinterpretation rules don't reach end users; people see a number
  and trust it.
- Composite trends become noisy and uninterpretable on boards with
  intermittent incident data.

### Alternative B — Coerce to elite (keep current `?? 0` for CFR/MTTR)

Accept the current "no incidents → elite" coercion as a feature.

Ruled out because:
- Asymmetric (Lead Time is penalised by the same logic).
- Teams that simply don't track incidents in Jira appear to be
  outperforming teams that do — penalising honesty.

### Alternative C — Fail closed (composite = 0 when any dimension N/A)

Treat any missing dimension as a hard failure.

Ruled out because:
- Most boards have at least one dimension routinely missing
  (Kanban boards have no sprint-scoped MTTR signal in practice);
  scores would be uniformly zero and the report would be useless.

### Alternative D (recommended) — N/A propagation + weight renormalisation

See Proposed Solution.

---

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Database | None | `SprintReport` cache rows become stale; truncate or version-bump |
| API contract | Additive (with one breaking change) | `composite` becomes `number \| null` — frontend must handle null |
| Frontend | Component change | New "Insufficient data" state and `~` indicator on `SprintReportScoreCard` |
| Tests | Significant | `scoring.service.spec.ts` and `sprint-report.service.spec.ts` need fixtures for each N/A combination |
| External API | None | |
| Infrastructure | None | |
| Observability | New log field | Log `excludedDimensions` per sprint report so we can see how often each dimension is N/A |
| Security / Compliance | None | |

## Open Questions

- **What composite to display in the trend chart when one period has
  `composite = null`?** Recommend: a gap in the line (no point), with
  the period still appearing on the X-axis.
- **Sprint Report API stability:** the `composite: number → number | null`
  change is breaking for the MCP server and any external consumer.
  Coordinate the release with the MCP package's next minor version.

## Acceptance Criteria

- `SprintReportService.getReport` returns `composite: number | null`,
  `contributingDimensions: ScoreDimension[]`,
  `excludedDimensions: ScoreDimension[]`, `totalWeightApplied: number`.
- `ScoringService.scoreDeliveryRate`,
  `scoreScopeStability`, `scoreRoadmapCoverage` return `null` (not 50)
  when their denominator is 0.
- `SprintReportService` no longer applies `?? 0` or `?? 9999` defaults;
  missing DORA values propagate as `null` end-to-end.
- A unit test asserts: a sprint with only Delivery Rate available
  produces `totalWeightApplied = 0.25`, composite = the Delivery Rate
  score (renormalised to 100% weight).
- A unit test asserts: a sprint with no data in any dimension produces
  `composite = null`.
- Frontend `SprintReportScoreCard` renders "Insufficient data" when
  `composite === null` and renders a `~` modifier when
  `totalWeightApplied < 1`.
- ADR 0052 (to be created on acceptance) documents the renormalisation
  formula and the explicit choice to fail open per-dimension rather
  than fail closed.
