# 0006 — Sprint Membership at Start Date Reconstructed from Jira Changelog

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Project setup team
**Proposal:** N/A

## Context

Accurate planning accuracy measurement (and several other DORA calculations) requires
knowing which issues were committed to a sprint at the moment the sprint started —
not which issues are in the sprint today. Jira does not provide a historical sprint
membership snapshot: the `sprint` field on an issue reflects only the current state.
Issues are routinely added to or removed from sprints mid-sprint (scope change), and
issues from a closed sprint may have since been moved. Without reconstruction, planning
accuracy numbers would reflect current state rather than original commitment.

## Options Considered

### Option A — Reconstruct from Sprint-field changelog entries with a grace period
- **Summary:** Replay all changelog entries that change the `Sprint` field; derive the
  set of issues whose last Sprint-field change before `startDate + 5 minutes` added
  them to the sprint
- **Pros:**
  - Produces an accurate historical snapshot of sprint commitment
  - Uses data Jira already exposes via the issue changelog API
  - 5-minute grace period handles Jira's known delay in bulk sprint-add operations
- **Cons:**
  - Computationally expensive (must process all changelog entries for all issues)
  - Changelog entries may be missing for very old issues or migrated data
  - Logic is non-trivial to implement and test correctly

### Option B — Use current sprint membership as a proxy
- **Summary:** Accept that the sprint field reflects today's state and use it as-is
- **Pros:**
  - Zero implementation complexity
- **Cons:**
  - Produces incorrect planning accuracy for any sprint where scope changed (the common case)
  - Closed sprints with moved issues will show inaccurate data indefinitely
  - Fundamentally defeats the purpose of planning accuracy measurement

### Option C — Require teams to tag issues with a "committed" label at sprint start
- **Summary:** Use a Jira label (e.g. `sprint-committed`) applied manually at sprint
  start as the source of truth
- **Pros:**
  - Simple to query; no changelog parsing required
- **Cons:**
  - Requires manual discipline from all teams on every sprint start — not realistic
  - Existing historical data has no such labels; no retrospective coverage
  - Adds a Jira process burden outside the tool's control

## Decision

> We will reconstruct sprint membership at the sprint start date by replaying
> Sprint-field changelog entries for each issue, applying a 5-minute grace period
> after `startDate` to account for Jira's bulk-add delay.

## Rationale

Option B produces fundamentally incorrect metrics — it is not a viable approach.
Option C is impractical for historical data and requires external process discipline.
Changelog reconstruction (Option A) is the only approach that works correctly with
existing Jira data. The computational cost is paid once at sync time (not per query),
which is acceptable given the Postgres caching architecture (ADR-0002). The 5-minute
grace period is a known pragmatic adjustment for Jira's batch sprint-add behaviour.

## Consequences

- **Positive:** Planning accuracy reflects actual sprint commitment, not current state;
  works on all historical data without any team process changes
- **Negative / trade-offs:** Sync job must process and store changelog entries for all
  issues; reconstruction logic adds complexity to the sync pipeline
- **Risks:** If Jira truncates or omits changelog entries for very old issues, those
  issues will be excluded from historical snapshots without warning; the grace period
  value (5 minutes) may need tuning per board

## Related Decisions

- [ADR-0002](0002-cache-jira-data-in-postgres.md) — Reconstruction is performed at
  sync time and results stored in Postgres; not recalculated per query
- [ADR-0005](0005-kanban-boards-excluded-from-planning-accuracy.md) — Reconstruction
  only applies to Scrum boards; Kanban boards are excluded entirely
