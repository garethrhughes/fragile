# 0077 — Sprint membership: current members with only out-of-window changelog are committed

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Developer Agent
**Proposal:** n/a (bug fix; regression test added)

## Context

`SprintMembershipService.classifyForSprint` (ADR 0049) classifies each issue into
committed / added / removed for a sprint by replaying its Sprint-field changelog within the
`[startDate, effectiveSprintEnd]` window (ADR 0066: `effectiveSprintEnd = completeDate ?? endDate`).
DATA-450 was a genuine member of sprint 4134 (present in the `jira_issue_sprints` join table,
and the carry-over changelog's `fromId` = 4134 proves it was in the sprint) but did **not**
appear on the sprint detail page or in planning accuracy.

Root cause: DATA-450's only Sprint-field changelog is the Jira "Complete Sprint" carry-over,
which Jira timestamps a few hundred milliseconds **after** the sprint's `completeDate`
(changelog `22:48:35.912` vs `completeDate 22:48:35.680`). The classification loop skips any
changelog with `changedAt > sprintEnd`, so the only evidence was discarded, `wasInSprintAtDate`
returned false (its single log was after the window), and none of `wasAtStart` / `wasCarryOver`
/ `wasAddedDuringSprint` fired. The `if / else if` had no final branch, so the issue was
classified into no set and silently dropped from `committedKeys ∪ addedKeys`.

## Options Considered

### Option A — Treat unclassified current members as committed
- **Summary:** After the loop, if an issue is in `currentMemberKeys` (join table) but was
  classified into none of the four sets, add it to `committedKeys`.
- **Pros:** Fixes the reported case with minimal blast radius; a join-table member with no
  in-window add/remove evidence was, by definition, in the sprint and never removed.
- **Cons:** Relies on the join table being correct for closed sprints.

### Option B — Widen the end-window guard by a grace period
- **Summary:** Allow changelog entries up to N seconds after `completeDate`.
- **Cons:** Arbitrary threshold; a carry-over `toId` still lists the *next* sprint, so parsing
  it as "in this sprint at end" is fragile; risks misclassifying real post-completion moves.

### Option C — Ignore (accept the data gap)
- **Cons:** Under-counts commitment and hides real sprint members — the reported defect.

## Decision

Add a final branch to `classifyForSprint`: an issue in `currentMemberKeys` that matched none of
the committed / carry-over / added conditions is added to `committedKeys` (and not marked
removed). It was a member of the sprint per the join table and has no in-window evidence of a
mid-sprint addition or removal, so it is treated as committed at start.

## Rationale

The join table (`JiraIssueSprint`) is the authoritative record of current membership (ADR 0048).
An issue that is a member but whose only changelog activity falls outside `[start, end]` was in
the sprint the whole observable time; committed is the correct classification. Real mid-sprint
additions still produce an in-window `toId` transition and are caught earlier as `added`, so this
branch cannot misclassify them. This fixes both sprint detail (which shows committed ∪ added) and
planning accuracy (commitment = committedKeys) in one place.

## Consequences

- **Positive:** DATA-450-style members (carry-over changelog just after `completeDate`, or any
  member with only out-of-window changelog) are correctly counted as committed and shown.
- **Negative / trade-offs:** Correctness now depends on the join table for these edge issues; if
  the join table is stale, classification follows it.
- **Risks:** Low. Guarded by a regression test reproducing the exact DATA-450 timestamps.

## Related Decisions

- Refines ADR 0049 (single-source membership reconstruction). Interacts with ADR 0066
  (`effectiveSprintEnd`), ADR 0048 (join table), ADR 0039 (carry-over), ADR 0052 (disjoint
  removed sets).
