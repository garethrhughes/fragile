# 0010 — Kanban Roadmap Accuracy via Changelog Board-Entry Date and Quarter Bucketing

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Decision Log Agent, implementation reviewed
**Proposal:** N/A

## Context

ADR-0009 (Decision 7) established that `GET /api/roadmap/accuracy` returns `[]` for
Kanban boards, on the grounds that the metric was sprint-scoped by design. The
requirement subsequently changed: Kanban boards should produce roadmap accuracy rows,
grouped by quarter rather than sprint. This required answering a concrete question: what
date should be used to assign a Kanban issue to a quarter? Jira offers several candidate
timestamps for each issue, and the choice affects whether the resulting metric reflects
"when work was planned" or "when it was written down".

## Options Considered

### Option A — Use `createdAt` as the bucketing date
- **Summary:** Assign each issue to the quarter in which it was created in Jira
- **Pros:**
  - Always present; no changelog dependency
  - Cheapest to compute — no changelog traversal needed
- **Cons:**
  - Reflects when the ticket was written, not when work started
  - Issues created in advance (e.g. backlog grooming months ahead) would be
    bucketed into an earlier quarter than they were actually worked on
  - Falls back to creation date even when a meaningful work-start signal exists

### Option B — Use the first `To Do → *` status transition from the changelog
- **Summary:** Find the earliest changelog entry where `fromValue = 'To Do'`; treat
  that timestamp as the "board-entry date" when the issue was actively pulled into flow
- **Pros:**
  - Represents when work was started, not when the ticket was written
  - Consistent with how flow-based metrics (cycle time, lead time) define work start
  - Fall-through to `createdAt` handles the minority of issues that are created
    directly in a non-`To Do` state
- **Cons:**
  - Requires a changelog traversal per issue
  - ~15 % of issues (e.g. PLAT board data) have no such transition and must fall back

## Decision

> We will use the earliest status changelog entry where `fromValue = 'To Do'` as the
> board-entry date for Kanban issues; fall back to `createdAt` for issues with no such
> transition. Issues are then bucketed by the quarter of that board-entry date.

## Rationale

`createdAt` measures when the ticket was written, which may have no relationship to
when the team decided to work on it. The `To Do → *` transition is the best available
changelog signal for when an issue was actively pulled onto the Kanban board and work
was committed to beginning. This is consistent with standard Kanban flow metric
conventions. The `createdAt` fallback is necessary and acceptable: issues created
directly in an active state (e.g. `In Progress`) have already bypassed `To Do`,
so the creation date is a reasonable proxy for their board-entry date. The ~15 %
fallback rate observed on the PLAT board is low enough to not distort the overall
metric.

This decision supersedes ADR-0009 Decision 7, which returned `[]` for Kanban boards.
Sprint-based rows (with a `sprintId` parameter) remain unsupported for Kanban boards
and return HTTP 400 as before.

## Consequences

- **Positive:**
  - Kanban boards now produce meaningful roadmap accuracy rows, grouped by quarter
  - Quarter rows represent "issues pulled onto the board in that quarter" — a
    coherent and actionable unit for planning alignment review
  - The fallback to `createdAt` ensures all issues are bucketed; no issues are silently
    dropped from the metric
- **Negative / trade-offs:**
  - The board-entry date is an approximation: if a team has a workflow that does not use
    a `To Do` column (or uses a different initial status name), the fallback rate will be
    higher and the `createdAt` proxy less accurate
  - Sprint view (`?sprintId=`) is explicitly rejected with HTTP 400 for Kanban boards;
    callers must use the quarter-grouped endpoint
- **Risks:**
  - Teams that frequently create issues directly in `In Progress` or `In Review` will
    see higher fallback rates; this should be monitored and communicated
  - If a future workflow adds a pre-`To Do` status, the `fromValue = 'To Do'` heuristic
    may no longer identify true board-entry; the logic should be revisited if the PLAT
    board workflow changes

## Related Decisions

- [ADR-0005](0005-kanban-boards-excluded-from-planning-accuracy.md) — Original exclusion
  of Kanban boards from the planning accuracy report; the pattern of excluding sprint-
  based views for Kanban is preserved here
- [ADR-0006](0006-sprint-membership-reconstructed-from-changelog.md) — Changelog
  reconstruction precedent; this decision applies similar changelog-replay logic to
  Kanban board-entry detection
- [ADR-0009](0009-roadmap-accuracy-jpd-sync-strategy.md) — Decision 7 in that ADR
  (Kanban → empty array) is superseded by this ADR
