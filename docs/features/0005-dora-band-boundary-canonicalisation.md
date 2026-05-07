# Feature 0005 — DORA Band Boundary Canonicalisation

**Status:** In Progress
**Proposal:** [0052](../proposals/0052-dora-band-boundary-canonicalisation.md)
**ADR:** [0054](../decisions/0054-dora-band-boundary-canonicalisation.md) (pending)
**Date:** 2026-05-07

---

## Summary

Make `<` strictly less than the canonical operator across all upper-bound
DORA band classifiers (Lead Time, Change Failure Rate, MTTR). Deployment
Frequency retains `>=` (lower-bound metric, spec uses `≥`). Add a
shared boundary fixture consumed by both backend and frontend test
suites to prevent future drift. Audit the recommendation rules and
correct any operator that crosses the classifier boundary in the
opposite direction (e.g. LT-004 fires `<= 1` while classifier says
`< 1`).

## Acceptance Criteria

1. `backend/src/metrics/dora-bands.ts` and `frontend/src/lib/dora-bands.ts`
   use `<` for all upper-bound thresholds (LT, CFR, MTTR). DF unchanged.
2. `docs/dora-bands-fixture.json` exists with ≥40 cases covering boundary,
   just-below, and just-above values for every band on every metric.
3. Both `backend/src/metrics/dora-bands.spec.ts` and
   `frontend/src/lib/dora-bands.test.ts` consume the fixture and assert
   identical classifications.
4. Every threshold rule in
   `backend/src/sprint-report/recommendation.service.ts` is audited; rules
   whose operator disagrees with the classifier (e.g. LT-004's `<= 1`)
   are corrected to match.
5. Lead Time `7.0` days → `medium` (was `high`).
6. Lead Time `30.0` days → `low` (was `medium`).
7. Lead Time `1.0` day → `high` (band) and recommendation does NOT fire
   the elite-LT recommendation (LT-004).
8. CFR `5.0`, `10.0`, `15.0` → `high`, `medium`, `low` respectively
   (each value flips down one band).
9. MTTR boundaries unchanged (already `<`).
10. ADR 0054 documents the operator convention and the cross-suite
    fixture pattern.

## Out of Scope

- Re-snapshotting historical `dora_snapshots` rows. They refresh on next
  sync via PK overwrite.
- Changing DF to a strict operator. Spec wording uses `≥`; DF retains `>=`.
- Release notes / user-facing communication. Recommended as a follow-up.

## Notes

The audit specifically called out LT-004 as the visible inconsistency.
Other rules in `recommendation.service.ts` should be swept for the same
class of bug: any `<=` or `>=` comparison against a band-boundary
constant (1, 7, 30, 5, 10, 15, 1, 24, 168) is suspect.
