# ADR 0046 — Support Report: Sprint-Membership Issue Population

**Date:** 2026-05-06
**Status:** Accepted
**Proposal:** [0044 — Support Report: Sprint-Membership Issue Scope](../proposals/0044-support-sprint-membership-scope.md)
**Supersedes (in part):** ADR 0045 §"Period scoping" — replaces the "completed in period" gate for sprint mode only.

---

## Context

ADR 0045 established that `totalIssues` (the denominator for support percentage) is scoped
to issues that completed within the requested period. This is correct for quarters but wrong
for sprints: an in-progress issue is part of the sprint's support burden, and a carry-over
issue that was active in two consecutive sprints should count against both.

Relying on `jira_issues.sprintId` (current assignment) alone misses Sprint N for any issue
that was carried over to Sprint N+1, because Jira updates `sprintId` to the latest sprint
on carry-over.

---

## Decision

**Sprint mode uses changelog-based membership, not completion date.**

An issue belongs to a sprint for the purposes of the Support Report if:
1. The sprint's name appears in any `jira_changelogs.toValue` where `field = 'Sprint'` for
   that issue (comma-separated names are split and matched individually), **or**
2. The issue's current `jira_issues.sprintId` matches the requested sprint's ID (covers
   issues added mid-sprint with no prior sprint changelog entry).

In sprint mode:
- `totalIssues` = all sprint-member work items (passing `isWorkItem`) regardless of status.
- Support tickets that are in-progress appear in the ticket table with `cycleTimeDays = null`,
  `completedAt = null`, and `band = null`.
- p50/p95 are computed only over support tickets with a non-null `cycleTimeDays` (completed
  within the sprint window). The UI labels these "Completed tickets only".
- A carry-over issue (sprint changelog references both Sprint N and Sprint N+1) appears in
  both sprints' support results.

**Quarter mode is unchanged.** The "completed in period" gate and all 16 existing unit tests
remain valid.

---

## Consequences

- **Positive:** In-progress support tickets are visible in the sprint view, giving teams
  accurate load visibility mid-sprint.
- **Positive:** Carry-over issues count in both sprints, reflecting that work happened in
  both periods.
- **Positive:** No schema change — `jira_changelogs` already stores sprint assignment events
  with `field = 'Sprint'`.
- **Neutral:** One additional bulk query per sprint-mode request (sprint changelogs). All
  queries are bulk-fetched with `IN` — no N+1.
- **Neutral:** `resolvePeriod` now returns `isSprint: boolean` and `sprintName?: string`.
  The public DTO shapes are unchanged.
