# 0066 — Use Sprint Actual Close Time (completeDate) for Completion & Metric Windows

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Infosec Agent
**Proposal:** docs/proposals/0072-sprint-effective-end-completedate.md

## Context

Sprint completion and every sprint-scoped metric window bounded on the **scheduled**
`sprint.endDate`, but teams frequently close sprints after their scheduled end. Jira
returns the actual close time as `completeDate`, which the sync discarded. As a result,
work completed between the scheduled end and the real close was silently excluded — e.g.
sprint DATA/4129 (`endDate` 2026-07-02T16:00Z, `completeDate` 2026-07-06T00:12Z) reported
`completedInSprintCount = 0` while Jira's burndown correctly showed 8 issues completing as
the sprint closed. Measured on the local DB, 717 issues across 81 closed sprints on all 5
scrum boards were affected.

## Options Considered

### Option A — Persist `completeDate`; use `effectiveSprintEnd = completeDate ?? endDate ?? now` for completion/metric windows
- **Summary:** Store the actual close time and use it as the window upper bound, keeping scheduled `endDate` for selection/filtering.
- **Pros:** Matches Jira's own burndown; corrects all late-closed sprints; retains scheduled-vs-actual distinction; single shared helper.
- **Cons:** Schema migration + re-sync; historical reported numbers shift (upward, correcting undercount).

### Option B — Overwrite `endDate` with `completeDate` on sync
- **Summary:** No new column; store the actual close in the existing field.
- **Cons:** Destroys the scheduled-vs-actual distinction that quarter selection/bucketing relies on; a sprint closed in the next quarter would move quarters and distort period reports.

### Option C — Narrow scope (completion windowing only: sprint-detail + planning)
- **Summary:** Fix only the two completion services.
- **Cons:** Membership, roadmap, gaps and sprint-scoped DORA would keep using `endDate`, leaving inconsistent "when did the sprint end" semantics across views.

## Decision

We will persist Jira's `completeDate` on `JiraSprint` and use a shared
`effectiveSprintEnd(sprint) = completeDate ?? endDate ?? now` helper as the upper bound of
every completion / membership / metric window (sprint-detail, planning, sprint-membership,
roadmap in-sprint classification, gaps closed-sprint window, and sprint-scoped DORA), while
sprint **selection / filtering / bucketing** continues to use the scheduled `endDate`.

## Rationale

Option A matches Jira's authoritative burndown and corrects a systemic undercount without
losing the scheduled date that period selection depends on (ruling out B). Applying the
effective end across all windowing consumers — not just the two completion services (C) —
gives one coherent definition of "when the sprint ended" so Planning, Roadmap, Gaps and
DORA agree. The fallback chain is expressed once in a shared helper to prevent divergence.

## Consequences

- **Positive:** Completion, planning accuracy, roadmap coverage, gaps and sprint-scoped
  DORA now credit work finished before a late close; Sprint Detail and Planning agree
  (both apply `SPRINT_GRACE_PERIOD_MS`); the Sprint Detail "Completed" tooltip is now
  accurate; `completeDate` exposed additively for future "closed late" UI.
- **Negative / trade-offs:** Historical reported numbers change (upward) for late-closed
  sprints once re-synced — expected, but dashboards will shift. Requires a schema migration
  and a re-sync to populate `completeDate` on existing rows.
- **Risks:** A sprint left in `active` state indefinitely with no `completeDate` falls back
  to `endDate` then `now`; a sprint reopened in Jira after close could change `completeDate`
  on the next sync (acceptable — it mirrors source truth).

## Related Decisions

- [0006](0006-sprint-membership-reconstructed-from-changelog.md) — completion/membership is
  reconstructed from the changelog; this ADR corrects the *window* those reconstructions use.
- [0039](0039-carry-over-sprint-issue-classification.md) — carry-over classification relies
  on the sprint window lower bound; unchanged here (only the upper bound moves).
- Proposal 0055 (D-2 carry-over guard) — the lower-bound guard is preserved; only the upper
  bound now uses the effective end.

## Selection-vs-window audit (implementation reference)

**Effective end (changed):** `sprint-detail.service.ts`, `planning.service.ts`,
`sprint-membership.service.ts`, `roadmap.service.ts` (in-sprint), `gaps.service.ts`
(closed-sprint), `metrics.service.ts` (sprint-scoped DORA/cycle-time).

**Scheduled endDate (unchanged):** quarter selection (`roadmap`/`planning`
`WHERE s.endDate <= :end`), week-overlap (`all-items`), quarter range / latest-sprint
selection (`metrics`), and displayed `endDate` fields.
