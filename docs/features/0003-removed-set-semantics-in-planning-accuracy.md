# 0003 — Removed-Set Semantics in Planning Accuracy

**Date:** 2026-05-07
**Status:** Draft
**Source:** Manual (driven by proposal 0050)
**Related proposal:** docs/proposals/0050-removed-set-semantics-in-planning-accuracy.md

## Summary

Split `SprintMembership.removedKeys` into two disjoint sets — `committedRemovedKeys`
(present at start, gone by end) and `addedRemovedKeys` (joined after start, gone by end).
Migrate `PlanningService`, `SprintDetailService`, and `SupportService` to use the correct
set per formula, eliminating the double-count of add-then-remove churn that today inflates
`scopeChangePercent` and shrinks the `completionRate` divisor.

## Background / Motivation

`SprintMembershipService.reconstruct` (canonicalised in ADR 0049) currently emits a single
`removedKeys` set containing every issue that left the sprint after start — regardless of
whether it was committed at start or added mid-sprint. `PlanningService` then plugs that
union into two formulas:

- `scopeChange% = (added + removed) / commitment * 100` — double-counts any issue that
  was added then removed (it appears in both `added` and `removed`).
- `completionRate = completed / (commitment + added - removed) * 100` — divisor is
  smaller than the actual final-sprint set when add-then-remove churn occurred.

`SprintDetailService` reports the same numbers but with subtly different intent at one
call site, leading to the symptom that brought the issue to attention: the planning page
and the sprint detail page show different "committed" / "removed" counts for the same
sprint.

## Scope

**In scope**
- Replace `removedKeys` with two disjoint sets (`committedRemovedKeys`,
  `addedRemovedKeys`) on `SprintMembership` (clean break — no deprecated alias).
- Add a pure `summariseMembership(m)` helper exporting `commitmentCount`,
  `addedCount` (gross), `removedCount` (committed-removed only), `finalSetSize`,
  `scopeChangePercent`.
- Migrate `PlanningService.calculateAccuracy` to consume the helper. The existing API
  fields `commitment` / `added` / `removed` keep their names; their numeric meanings
  are corrected (`removed` = committed-removed only, no double counting).
- Migrate `SprintDetailService` and `SupportService` to consume the helper / new sets.
- Update all spec fixtures (planning, sprint-membership, sprint-detail, support, roadmap)
  to use the new shape; add property test asserting disjointness; add planning-accuracy
  test for add-then-remove churn (5 issues add+remove → `scopeChange%` reflects
  `(0 committedRemoved + 5 addedKeys) / commitment`, NOT
  `(5 added + 5 removed) / commitment`).
- Write ADR 0052 documenting canonical formulas and the clean-break migration.

**Out of scope**
- New API fields for the disjoint sets (decision 2026-05-07: counts only).
- Changing the *names* of API fields `commitment` / `added` / `removed`.
- Frontend changes beyond what falls out from the corrected numbers (no label changes).
- DORA metrics, CFR, lead time — proposal 0050 is purely planning-accuracy.

## Acceptance Criteria

- Given any reconstructed `SprintMembership`, when checked, then
  `committedRemovedKeys ∩ addedRemovedKeys = ∅` (asserted by property test).
- Given a sprint with 5 issues added then removed mid-sprint and no committed-removals,
  when planning accuracy is computed, then `scopeChangePercent` equals
  `addedKeys.size / commitment * 100` (the 5 add-then-remove issues contribute via
  `addedKeys` only — they do **not** also contribute via `removed`).
- Given the same sprint, when `completionRate` is computed, then the divisor equals
  `currentMemberKeys.size` (the actual final-sprint set, mathematically equivalent to
  `commitment - committedRemovedKeys.size + (addedKeys.size - addedRemovedKeys.size)`).
- Given the planning page and sprint detail page render the same sprint, then they
  display identical `commitment`, `added`, and `removed` counts (asserted by an
  integration test that drives both services from the same membership fixture).
- Given the existing test suites, when run after the change, then all tests pass with
  fixtures updated to the new shape (no skipped tests, no `removedKeys` references
  remain in production code).
- Given the change is merged, then ADR 0052 exists in `docs/decisions/` and is
  referenced from `docs/decisions/README.md`; proposal 0050 is marked Accepted.

## Open Questions

- None remaining. Three design questions in proposal 0050 are resolved:
  - Backward-compat getter → **clean break** (no deprecated alias).
  - `summariseMembership` shape → **gross counts** for `addedCount`,
    committed-only for `removedCount`.
  - API DTO scope → **counts only**, no new fields.

## Notes

- Stacked branch: continues from `feature/0001-support-detection-epic-matching`
  (proposal 0049 work just landed on the same branch).
- New ADR number is **0052** (0051 was taken by proposal 0049 yesterday).
- No schema changes, no migration, no infra changes, no API surface change beyond
  corrected numeric values for existing fields.
- No new dependencies.
