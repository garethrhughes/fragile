# 0049 — Single SprintMembershipService for sprint membership reconstruction

**Date:** 2026-05-06
**Status:** Accepted
**Deciders:** Architect Agent, User
**Proposal:** docs/proposals/0048-sprint-membership-service.md

## Context

Four services — `PlanningService`, `SprintDetailService`, `RoadmapService`, and
`SupportService` — each independently reconstruct per-sprint issue membership from
`JiraChangelog` rows plus the `JiraIssueSprint` join table. Their algorithms have
diverged: only `PlanningService` matches changelog rows by sprint **ID** (`fromId`/`toId`),
falling back to name; the other three match by **name only**. When Jira renames a sprint
mid-life (observed on ACC sprint 3941, renamed `Ready to estimate 2` → `Sprint 2`),
name-only matching misses changelog entries written under the old name.

In production today the same sprint returns three different counts depending on the
endpoint queried: planning reports `commitment=17`, sprint-detail reports `0`, roadmap
reports `13`. The root cause is duplicated logic, not the algorithm itself — patching
each caller leaves four copies that will re-diverge on the next change.

## Options Considered

### Option A — Patch each caller in place (port ID-matching to the three broken services)
- **Summary:** Smallest diff; copy the ID-based matching from `PlanningService` into the other three.
- **Pros:** Fastest to ship; minimal review surface.
- **Cons:** Leaves four parallel implementations; the next change (e.g. supporting Jira's `activatedDate` field) requires touching all four; high probability of future re-divergence.

### Option B — Pure utility function
- **Summary:** Move the algorithm into `backend/src/lib/sprint-membership.ts`; callers pass in pre-fetched changelog/sprint/member arrays.
- **Pros:** No new module; trivially testable.
- **Cons:** Each caller still issues the same three queries with subtly different filters — duplication moves up the stack rather than disappearing.

### Option C — Extract `SprintMembershipService` (new module)
- **Summary:** New `SprintMembershipModule` exporting `SprintMembershipService`, owning both the queries (changelog, closed sprints, join-table membership) and the reconstruction algorithm. All four callers depend on it; their inline logic is deleted.
- **Pros:** One canonical implementation; one canonical test suite; future changes to the algorithm touch one file; per-caller specs simplify dramatically (mock the service rather than the three repositories).
- **Cons:** Larger initial diff; one extra module in the dependency graph.

## Decision

We will create `SprintMembershipModule` in `backend/src/sprint-membership/` exporting
`SprintMembershipService` as the single source of truth for sprint membership
reconstruction. `PlanningService`, `SprintDetailService`, `RoadmapService`, and
`SupportService` are refactored to depend on it; their inline implementations and the
duplicated helper functions (`sprintValueContains`, `sprintIdContains`, `wasInSprintAtDate`,
`isCarryOverFromSprint`, `SPRINT_GRACE_PERIOD_MS`) are deleted.

## Rationale

The bug is not in the algorithm — `PlanningService` already implements it correctly. The
bug is that three other services reproduce a worse version of the same logic. Patching
each caller (Option A) fixes the immediate symptom but guarantees the next change to
sprint membership semantics will need to touch all four files again, with the same risk
of partial application that produced the current divergence. A pure utility (Option B)
solves half the problem and leaves the query duplication intact — which is where the
fromId/toId interpretation difference actually lives. A dedicated service (Option C)
collapses both the algorithm and its supporting queries into one testable unit.

## Consequences

- **Positive:**
  - One implementation to test, review, and maintain.
  - All four endpoints return consistent sprint membership counts; the ACC Sprint 2
    discrepancy is fixed structurally.
  - Per-caller spec files shrink — they mock `SprintMembershipService.reconstruct()`
    rather than three repositories with hand-built fixtures.
  - Future enhancements (e.g. `activatedDate` support, alternate carry-over heuristics)
    require changes in exactly one place.
- **Negative / trade-offs:**
  - Larger upfront diff than a per-caller patch (~four service refactors plus new module).
  - One extra module in the NestJS dependency graph; callers must declare the import.
- **Risks:**
  - Behavioural change in `SprintDetailService`, `RoadmapService`, `SupportService`:
    they will start surfacing issues that previously fell through name-only matching.
    Acceptance test against ACC sprint 3941 (`committedCount=17`) plus the existing
    807-test suite must remain green.
  - Inconsistent fixture mocking across migrated specs; mitigated by migrating one
    caller at a time and running the full suite between steps.

## Related Decisions

- Builds on [ADR 0048](0048-sync-cancelled-issues-and-multi-sprint-membership.md) — the `JiraIssueSprint` join table and JQL-based scrum sync that this service consumes.
- Reinforces [ADR 0006](0006-reconstruct-sprint-membership-from-changelog.md) — sprint membership at start date must be reconstructed from changelog; this ADR consolidates that reconstruction into one location.
- Touches [ADR 0039](0039-carry-over-sprint-issue-classification.md) — the carry-over classification helper moves into the new service unchanged.
