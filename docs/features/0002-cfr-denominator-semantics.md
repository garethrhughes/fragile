# 0002 — CFR Denominator Semantics

**Date:** 2026-05-07
**Status:** Implemented
**Source:** Manual (driven by proposal 0049)
**Related proposal:** docs/proposals/0049-cfr-denominator-semantics.md

## Summary

Fix Change Failure Rate (CFR) so its numerator and denominator share units. CFR becomes
`failureCount / deploymentEventCount * 100`, where deployment events are the same set
produced by Deployment Frequency (one per fixVersion release; one per done-transition
where no fixVersion is associated, per ADR 0001).

## Background / Motivation

Current CFR (`backend/src/metrics/cfr.service.ts`) divides failure-issue count by *distinct
deployment days*. Numerator counts issues; denominator counts days. The result is only
correct when every deployment day contains exactly one deployable change. For any board
that ships multiple PRs per day or batches releases, CFR is systematically wrong, and
the direction of error depends on team behaviour rather than signal.

This is the largest correctness defect surfaced by the May 2026 metrics audit (proposal
0049) and propagates from per-board CFR through `buildOrgDoraResult` /
`buildOrgDoraResultFromData` into the headline DORA banner, all DORA charts, the sprint
report composite score, and `DoraSnapshot` rows.

## Scope

**In scope**
- Rewrite `cfr.service.ts` to consume a `DeploymentEvent[]` from
  `deployment-frequency.service.ts` and compute `failures / events * 100`.
- Update `metrics.service.ts` org aggregation (`buildOrgDoraResult`,
  `buildOrgDoraResultFromData`) to sum events and failures across boards.
- Update all `cfr.service.spec.ts` and `metrics.service.spec.ts` fixtures and assertions.
- Truncate `dora_snapshot` on deploy; rely on next post-sync Lambda to repopulate
  (per ADR 0040). One-line operator note in ADR.
- Write ADR 0051 documenting the chosen definition (Definition C in proposal 0049).

**Out of scope**
- Frontend band thresholds (unchanged: ≤5%, ≤10%, ≤15%).
- Lead Time, Deployment Frequency, MTTR calculations.
- Configurability (Alternative D rejected in proposal 0049).
- Temporary side-by-side log line (user opted out).
- DORA-page banner explaining the historical jump (out of scope per proposal 0049).

## Acceptance Criteria

- Given a board with 10 fixVersion releases and 3 failure issues in the period, when CFR
  is computed, then the result is exactly `30.0` (and a regression test asserts the
  pre-fix day-count denominator path is no longer reachable).
- Given a period with no deployment events and no failures, when CFR is computed,
  then the result is `0` (no division by zero).
- Given multiple boards, when org-level CFR is computed via `buildOrgDoraResult`, then
  the result equals `Σ failures / Σ events * 100` across all boards.
- Given a deploy of this change, when the post-sync Lambda runs (or in-process snapshot
  computation locally), then `dora_snapshot` rows are repopulated with the corrected
  CFR values within one sync cycle.
- Given the existing CFR + org-aggregation test suites, when run after the change,
  then all tests pass with updated fixtures reflecting event-count semantics.
- Given the change is merged, then ADR 0051 exists in `docs/decisions/` and is
  referenced from `docs/decisions/README.md`; proposal 0049 is marked Accepted.

## Open Questions

- None remaining. The two open questions in proposal 0049 are resolved:
  - Snapshot invalidation strategy → **truncate `dora_snapshot` on deploy** (operator
    runs `TRUNCATE` once after deploy; next post-sync Lambda repopulates).
  - User-facing banner → out of scope; will be considered separately if requested.

## Notes

- Stacked branch: this work branches from `feature/0001-support-detection-epic-matching`
  (not yet merged), per user instruction.
- New ADR number is **0051** (not 0050 as proposal 0049 anticipates) — 0050 was already
  taken by the proposal-0055 batch in the prior session.
- No infrastructure changes (Lambda code path is untouched; only its inputs change).
- No new dependencies, no new endpoints, no auth surface change.
