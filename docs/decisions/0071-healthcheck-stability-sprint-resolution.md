# 0071 — Healthcheck Stability: planned = committed-or-carry-over against the sprint active at the in-progress moment

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Architect Agent
**Proposal:** docs/proposals/0076-healthcheck-report.md

## Context

Healthcheck Stability (ADR 0070) is `(100/|D|) * (number of denominator tickets that were
planned)`, scrum only. A weekly period can overlap two sprints on a single scrum board, so
"was this ticket planned?" is ambiguous unless we fix which sprint the question is asked
against.

## Options Considered

### Option A — Check against the sprint active at the ticket's in-progress moment
- **Summary:** For each `D` ticket, take its first-ever in-progress timestamp `t`, find the
  sprint whose `[startDate, effectiveSprintEnd]` window contains `t`, and test committed/carry-over
  against that sprint.
- **Pros:** Correct when a week spans two sprints; each ticket judged against the sprint it was
  actually started in.
- **Cons:** Requires reconstructing membership for all sprints overlapping the week.

### Option B — Check against the single sprint overlapping the week
- **Summary:** Pick one overlapping sprint for the whole board.
- **Pros:** Simpler.
- **Cons:** Wrong when the week straddles a sprint boundary — tickets started in the other
  sprint are misclassified.

## Decision

A denominator ticket counts toward the Stability numerator iff, for the sprint whose window
contains the ticket's first-ever in-progress timestamp, the ticket is in that sprint's
`committedKeys` (committed at start, ADR 0049) **OR** is a carry-over from the immediately prior
closed sprint (ADR 0039). Membership for all sprints overlapping the week is reconstructed in a
single `SprintMembershipService.reconstructMany` pass.

## Rationale

The requester specified that "planned" is judged at the point the ticket moves to In Progress,
against the sprint active at that moment — Option A implements this literally and handles the
two-sprint week correctly. Carry-over is included per the requester's confirmation that
carried-over work is also "planned".

## Consequences

- **Positive:** Accurate stability across sprint boundaries; reuses the single source of truth
  for membership (ADR 0049) and carry-over rules (ADR 0039).
- **Negative / trade-offs:** Slightly more computation (multiple sprint memberships per week).
- **Risks:** A ticket whose in-progress timestamp falls in no sprint window is treated as
  not-planned; acceptable — it was started outside any sprint.

## Related Decisions

- Refines ADR 0070. Depends on ADR 0049 (`SprintMembershipService`), ADR 0039 (carry-over),
  and `effectiveSprintEnd` (ADR 0066).
