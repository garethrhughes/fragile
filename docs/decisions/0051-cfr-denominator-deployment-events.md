# 0051 — CFR denominator: deployment events (Definition C)

**Date:** 2026-05-07
**Status:** Accepted
**Deciders:** architect, developer
**Proposal:** [0049-cfr-denominator-semantics](../proposals/0049-cfr-denominator-semantics.md)
**Supersedes:** the day-counting denominator chosen as fix C-4 in proposal 0030 (no separate ADR existed for that decision).

## Context

`DeploymentFrequencyService` and `CfrService` historically reported deployments
in different units. DF's `totalDeployments` counted **distinct deployment days**
(a `Set<string>` keyed by `YYYY-MM-DD` from either `version.releaseDate` or the
first done-transition's `changedAt`). CFR's denominator was implicitly the same
day-count, but its numerator (failure issues) was an issue count, not a
day-count. The two figures therefore disagreed whenever a board shipped more
than one fixVersion or done-transition on the same day:

- 10 fixVersion releases across 7 calendar days with 3 bug failures yielded
  CFR = 3/7 = 42.86 % — pulling the board's band toward "low" purely as an
  artifact of multi-release days.
- The DORA aggregate response exposed these mismatched units in two places
  (`deploymentFrequency.totalDeployments` and `changeFailureRate.totalDeployments`),
  causing the dashboard to display contradictory totals for the same period.

Proposal 0049 evaluated three options for unifying the units:
A) keep day-counting and rename failure metric to per-day,
B) switch CFR numerator to count failure-days, or
C) switch BOTH services to count **deployment events** (one per released
fixVersion, one per first done-transition for issues with no fixVersion).

## Decision

**Adopt Definition C: deployment events as the shared unit for both DF and CFR.**

A new pure-function module `backend/src/metrics/deployment-events.ts` exports
`deriveDeploymentEvents({issues, versions, changelogs, doneStatuses, startDate,
endDate})` returning `{events, deployedIssueKeys}`. The function:

- Emits one event per released fixVersion in the period (source: `fixVersion`).
- Emits one event per FIRST chronological done-transition for any work-item
  issue that does not have a fixVersion (source: `done-transition`).
- Skips done-transitions for issues already deployed via fixVersion (no
  double-counting).
- Applies `isWorkItem(issueType)` (ADR 0018) at derivation time — epics and
  subtasks never produce events.

`DeploymentFrequencyService.calculate` and `CfrService.calculate` both consume
this helper. `totalDeployments` on both result types now means **event count**.
CFR is computed as `failureCount / events.length * 100`, where `failureCount`
is the number of deployed issues (`deployedIssueKeys`) classified as failures
under the existing `failureIssueTypes`/`failureLabels`/`failureLinkTypes`
rules. Org-level aggregation in `MetricsService.buildOrgDoraResult` already
uses sum-of-totals + ratio-of-sums, so it inherits the corrected semantics
without code change.

## Consequences

### Positive

- DF's and CFR's `totalDeployments` are now the same number for the same board
  and period, restoring internal consistency in the DORA aggregate response.
- CFR is no longer artificially inflated by multi-release days. The 10-release
  / 3-bug example now yields the intuitive 30 %.
- A single shared derivation removes a class of drift bugs between the two
  services and gives a single place to extend the deployment signal in future
  (e.g. external deployment events from CI).
- Symmetric units make the in-process and Lambda DORA snapshot pipelines
  internally consistent without any schema change.

### Negative / Trade-offs

- Boards that ship multiple fixVersions per day will see DF rise and CFR fall
  versus prior numbers. This is a meaning change, not a regression — the old
  numbers were measuring different things in numerator vs denominator. Stale
  `dora_snapshots` rows are overwritten by `(boardId, snapshotType)` PK on the
  next scheduled or manual sync; no explicit truncate is required, but
  consumers will see a one-time discontinuity in trend lines at the deploy
  boundary for affected boards.
- `DeploymentFrequencyResult` now carries optional `events` and
  `deployedIssueKeys` fields for symmetry with CFR consumers. These are
  read-only and additive; no breaking change.

### Neutral

- Boards that ship at most one deployment per day (the common case for ACC,
  BPT, OCS, DATA) see no numerical change.
- The CFR endpoint signature, response DTO field names, and band classifier
  are unchanged.

## Related

- [ADR 0001](0001-jira-fix-versions-deployment-signal.md) — fixVersion is the
  primary deployment signal; done-status transition is the fallback. ADR 0051
  preserves both signals; it changes only the unit (event vs day) used to
  count them.
- [ADR 0018](0018-exclude-epics-subtasks-from-metrics.md) — work-item filter
  applied inside `deriveDeploymentEvents`.
- [Proposal 0030 fix C-4](../proposals/0030-second-audit-clear-bug-fix-batch.md)
  — chose day-counting as the fix to under-counting. ADR 0051 supersedes that
  code-level decision. C-4's intent (avoid under-count) is preserved; the unit
  is changed.
- [Proposal 0049](../proposals/0049-cfr-denominator-semantics.md) — driving
  proposal; contains worked examples and the three-option comparison.
