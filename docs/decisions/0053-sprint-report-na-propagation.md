# 0053 — Sprint Report scoring: N/A propagation and weight renormalisation

**Date:** 2026-05-07
**Status:** Accepted
**Deciders:** architect, developer
**Proposal:** [0051-sprint-report-scoring-na-handling](../proposals/0051-sprint-report-scoring-na-handling.md)

## Context

`SprintReportService` and `ScoringService` previously coerced missing
metric inputs into band-classifiable numeric values:

```typescript
// sprint-report.service.ts
deploymentsPerDay: dora.deploymentsPerDay ?? 0,         // → low
medianLeadTimeDays: dora.medianLeadTimeDays ?? 9999,    // → low
changeFailureRate:  dora.changeFailureRate  ?? 0,       // → elite
medianMttrHours:    dora.medianMttrHours    ?? 0,       // → elite

// scoring.service.ts — neutral 50 fallback
scoreDeliveryRate, scoreScopeStability, scoreRoadmapCoverage  // → 50 when denominator = 0
```

The combined effect was that a sprint with **no signal at all** still
received a composite ≥ 50/100 — indistinguishable from a real mid-tier
sprint. The system was also asymmetric: missing CFR/MTTR data flattered
the team (defaulted to elite), missing Lead Time penalised it
(defaulted to low), and the three `?? 50` neutral fallbacks injected
phantom mid-tier weight regardless of input. Teams using the score for
retro discussions were reading noise that the system silently
guaranteed would never look empty.

## Options Considered

### Option A — Document the neutral 50
- **Summary:** Keep the existing fallbacks; add user-facing documentation
  explaining that "no data" scores 50 and that scores in the 40–60
  range should be interpreted with caution.
- **Pros:** Zero code change.
- **Cons:** Reinterpretation rules don't reach end users; people see a
  number on a card and trust it. Composite trends remain noisy and
  uninterpretable on boards with intermittent incident data. Does not
  address the asymmetry between flattering and penalising fallbacks.

### Option B — Coerce all missing dimensions to elite
- **Summary:** Accept "no incidents = elite CFR/MTTR" as a feature and
  extend the same coercion to Lead Time and Deployment Frequency.
- **Pros:** Symmetric; no nullable types in the response.
- **Cons:** Penalises teams that honestly track incidents (their
  measured CFR is rarely 0; teams that don't track look elite).
  Inverts the signal the report exists to provide.

### Option C — Fail closed (composite = 0 if any dimension N/A)
- **Summary:** Treat any missing dimension as a hard zero for the
  composite score.
- **Pros:** Trivial to implement; impossible to mistake an N/A for a
  real value.
- **Cons:** Most boards routinely have at least one dimension missing
  (Kanban boards have no sprint-scoped MTTR signal in practice). The
  composite would be uniformly zero across the fleet and the report
  would carry no information.

### Option D — N/A propagation + weight renormalisation *(chosen)*
- **Summary:** Each scorer returns `{ score, weight } | null`. The
  composite is the weight-renormalised mean across non-null
  dimensions, or `null` when no dimension has data. The API response
  carries the contributing/excluded dimension lists and the fraction
  of total weight applied.
- **Pros:** Per-dimension fail-open keeps the report useful when some
  signals are missing; composite-level fail-closed when *all* signals
  are missing prevents phantom scores. Symmetric across all four DORA
  dimensions and the three Scoring-service dimensions. The
  `totalWeightApplied` field lets the UI honestly mark partial scores.
- **Cons:** Breaking API change — `compositeScore` and `compositeBand`
  become nullable; the MCP package must bump in lockstep. Frontend
  needs a new "Insufficient data" state and a `~` modifier.

## Decision

**Adopt Option D.** Sprint Report scoring propagates N/A end-to-end:

- `SprintReportService` no longer applies `?? 0` or `?? 9999` defaults
  to DORA inputs; `deploymentsPerDay`, `medianLeadTimeDays`,
  `changeFailureRate`, and `medianMttrHours` remain `number | null`.
- Each scorer in `ScoringService` returns
  `{ score: number; weight: number } | null`; `null` means
  "insufficient data — exclude from composite". `scoreDeliveryRate`,
  `scoreScopeStability`, and `scoreRoadmapCoverage` return `null`
  (not 50) when their denominator is 0.
- The composite is computed by the canonical formula:

  ```
  contributing  = scores.filter(s => s !== null)
  totalWeight   = Σ contributing.weight
  compositeScore = totalWeight > 0
    ? Σ (contributing.score × contributing.weight) / totalWeight
    : null
  totalWeightApplied = totalWeight / Σ all_weights        // [0, 1]
  ```

- The API response surface is extended:

  ```typescript
  interface SprintReportScore {
    compositeScore: number | null;
    compositeBand:  DoraBand | null;
    contributingDimensions: ScoreDimension[];
    excludedDimensions:     ScoreDimension[];
    totalWeightApplied:     number;   // 0..1
  }
  ```

Implementation: RED tests in commit `30cedab`, green implementation in
commit `1f87fe2`, proposal acceptance + feature spec in commit `ce894f1`.

## Rationale

The previous shape baked a silent guarantee into the type system: the
composite could never be empty, so it always *looked* meaningful even
when no signal had been collected. That guarantee inverted the
report's purpose. Per-dimension fail-open with composite-level
fail-closed is the only option that is symmetric across all
dimensions, useful on boards with naturally sparse signals, and
honest when the entire input is empty. Renormalising weights across
contributing dimensions preserves the relative importance the
designers chose without inventing values for dimensions that have
none. Surfacing `excludedDimensions` and `totalWeightApplied` moves
the "trust this number?" decision from a hidden coercion into an
explicit, user-visible signal.

## Consequences

- **Positive:**
  - A sprint with no signal in any dimension correctly returns
    `compositeScore = null`; the UI renders "Insufficient data" rather
    than a phantom 50.
  - The fallback asymmetry is gone — no dimension flatters or
    penalises the team by default.
  - `totalWeightApplied` makes partial composites first-class: the
    frontend renders a `~` modifier when `< 1` so users can see at a
    glance whether a score reflects full or partial signal.
  - A new structured log line per sprint report records
    `excludedDimensions`, giving operators visibility into which
    dimensions are routinely missing per board.
- **Negative / trade-offs:**
  - Breaking API change: `compositeScore` and `compositeBand` are now
    nullable. The MCP package was bumped to `1.1.0` in lockstep so the
    MCP tool description reflects the new shape; downstream MCP
    consumers must handle `null`.
  - `SprintReport` cache rows persisted under the old shape are now
    schema-incompatible with the nullable columns — handled by
    migration `1777000000000-MakeCompositeScoreNullable.ts`, which
    widens the columns; cached rows regenerate on the next sync.
  - Trend chart uses `connectNulls={false}` so periods with
    `compositeScore = null` produce gaps rather than misleadingly
    interpolated lines.
- **Risks:**
  - A future scorer added to `ScoringService` that returns a non-null
    fallback (e.g. defaults to 50 again) would silently defeat the
    renormalisation guarantee. Mitigated by the convention that all
    scorers return `{ score, weight } | null` and by the unit test
    that asserts a sprint with no data in any dimension produces
    `compositeScore = null`.

## Related Decisions

- [ADR 0052](0052-disjoint-removed-set-semantics.md) — precedent for
  clean-break correctness fixes in the metrics layer; ADR 0053 applies
  the same principle (eliminate a silent default that produced
  misleading numbers) to the sprint report scoring path.
- [Proposal 0022](../proposals/0022-sprint-report.md) — origin of the
  sprint report and its composite scoring model that this ADR refines.
- [Proposal 0051](../proposals/0051-sprint-report-scoring-na-handling.md)
  — driving proposal; contains the worked examples, the alternatives
  rejected here, and the acceptance criteria.
