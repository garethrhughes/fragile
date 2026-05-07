# 0050 — Third-audit clear bug-fix batch (proposal 0055)

**Date:** 2026-05-07
**Status:** Accepted
**Deciders:** architect, developer
**Proposal:** [0055-third-audit-clear-bug-fix-batch](../proposals/0055-third-audit-clear-bug-fix-batch.md)

## Context

A third correctness audit of the metrics pipeline produced two proposal batches:
0049–0054 (which require deeper design discussion and are deferred) and 0055 — a
batch of eight low-risk, high-confidence bugs and clean-ups that can be fixed
without further design debate. The bugs were independently reproducible from
the existing code and unit tests, and they touched four domains: ISO-week date
arithmetic, changelog query scoping, default status-name configuration, and
sprint completion date-bounds. None of the eight items required new modules,
schema changes, or API changes — but they did require a coordinated decision on
*where* shared logic should live, because three of the bugs were caused by
duplicated or near-duplicated code in different services drifting apart.

## Options Considered

### Option A — Per-service local fixes
- **Summary:** Fix each bug in place, leaving duplicated logic where it already exists.
- **Pros:** Smallest possible diff per fix; no cross-service refactor risk.
- **Cons:** Re-creates the conditions for the same drift in three months;
  `DEFAULT_IN_PROGRESS_NAMES` and the Sprint-changelog scan would remain
  copy-pasted across `lead-time.service.ts`, `mttr.service.ts`,
  `sprint-detail.service.ts`, and `quarter-detail.service.ts`.

### Option B — Fix bugs and consolidate the duplicated logic into shared modules
- **Summary:** Apply the eight bug fixes; in addition, extract
  `DEFAULT_IN_PROGRESS_NAMES` to `metrics/status-defaults.ts`, extract ISO-week
  arithmetic to `lib/iso-week.ts`, and add a public
  `firstSprintEntryDates({issueKeys, changelogsByIssue})` helper to
  `SprintMembershipService` so the Sprint-field changelog scan lives in exactly
  one place.
- **Pros:** Removes the *cause* of three of the eight bugs (drifted duplicates)
  rather than just the symptoms. Aligns with the existing pattern that
  `SprintMembershipService` (ADR 0049) is the single source of truth for sprint
  membership reasoning.
- **Cons:** Larger blast radius — touches 23 files; requires injecting
  `SprintMembershipService` into `QuarterDetailModule`; one round of test fixture
  updates for `quarter-detail.service.spec.ts`.

## Decision

We chose **Option B**: apply all eight fixes and consolidate the three pieces
of duplicated logic into shared modules in the same change set.

## Rationale

The eight items in proposal 0055 were not independent: A-1 (`daysToMonday`
ISO-week bug) and A-2 (dead `daysToMonday` helper) were the same code in two
services, C-1 (default `In Progress` names duplicated) was three services
holding three nearly-identical lists, and C-2 (Sprint-field changelog scan
duplicated) directly duplicated logic that already lives inside
`SprintMembershipService`. Fixing each in place under Option A would have left
the duplicates intact and reset the audit clock. ADR 0049 already established
that sprint-membership reasoning is a single-source-of-truth concern;
extending that contract to cover `firstSprintEntryDates` is a direct application
of the same principle.

## Consequences

- **Positive:**
  - Three classes of drift removed at the source: ISO-week arithmetic, default
    `In Progress` names, and the Sprint-field changelog scan each now have one
    canonical home.
  - `SprintMembershipService` now owns *all* changelog-driven sprint reasoning
    (C-2 extends the contract from ADR 0049 to cover board-entry dates as well
    as sprint membership).
  - D-2 (sprint completion date-bound check) now correctly excludes carry-over
    Done transitions from previous sprints — a class of false positives that
    silently inflated completion rate for any issue done before its current
    sprint started.
  - B-1 (changelog `changedAt BETWEEN` filter) was silently dropping status
    transitions that occurred *after* the report window for issues created
    *inside* the window — a class of false negatives in lead-time and DORA
    deployment counts. Removing the filter restores correctness; bounded
    blast radius via `issueKey IN (…)` keeps query cost stable.
- **Negative / trade-offs:**
  - `QuarterDetailService` constructor signature changed (added
    `SprintMembershipService` dependency); one spec file needed updating.
  - Larger commit than a per-fix approach. Mitigated by structured commit
    history (one commit per fix grouping) so individual fixes remain bisectable.
- **Risks:**
  - `firstSprintEntryDates` returns no entry for issues with no Sprint-field
    history; callers must apply `?? issue.createdAt` (or equivalent) fallback.
    This matches the prior in-place behaviour of `quarter-detail.service.ts`,
    but any future caller must remember the contract. Documented in the helper
    JSDoc.
  - The `SPRINT_GRACE_PERIOD_MS` constant (re-used by D-2 from
    `sprint-membership.service.ts`) is now applied to two distinct semantic
    questions: "was the issue a member of this sprint at time T?" and "was the
    issue completed within this sprint's window?". Both share the same
    rationale (clock skew between the Jira event timestamp and the sprint
    boundary timestamp), so the shared constant is appropriate, but a future
    requirement to tune one and not the other would force a split.

## Deviations from Proposal

- **D-4 (gaps half) not applied.** Proposal 0055 stated that
  `gaps.service.ts:10` imports `JiraChangelog` and constructor-injects
  `changelogRepo` "but neither is used". This was a misdiagnosis —
  `changelogRepo` is actively used at `gaps.service.ts:294` and
  `gaps.service.ts:314` for the Sprint-field changelog scan in the Scrum
  branch of `getGaps()`. The import and injection were therefore retained.
  The other half of D-4 (stale `// eslint-disable-next-line no-console`
  in `support.service.ts:482`) was removed as planned.

## Related Decisions

- [ADR 0049](0049-sprint-membership-service.md) — established
  `SprintMembershipService` as the single source of truth for sprint membership
  reconstruction. ADR 0050 extends that contract to cover board-entry dates
  (`firstSprintEntryDates`).
- [ADR 0024](0024-weekend-exclusion-cycle-time.md) — weekend-exclusion in lead
  time and cycle time. The `DEFAULT_IN_PROGRESS_NAMES` constant extracted by
  C-1 is consumed by the cycle-time calculation governed by ADR 0024.
- [ADR 0006](0006-reconstruct-sprint-membership-from-changelog.md) — sprint
  membership reconstructed from changelog. The D-2 fix (sprint completion
  lower-bound check) is in the same family of "Jira does not give us a clean
  historical snapshot, so we reconstruct from changelog" decisions.
