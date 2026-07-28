# 0015 — Use Sprint Actual Close Time (completeDate) for Metric Windows

**Date:** 2026-07-28
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0072-sprint-effective-end-completedate.md

## Summary

Fix sprint completion and metric windowing to use the sprint's **actual close time**
(Jira `completeDate`) rather than its **scheduled** `endDate`. Jira returns `completeDate`
when a sprint is closed; we currently discard it. Persist it on `JiraSprint`, populate it
during sync, and use an **effective end = `completeDate ?? endDate`** as the upper bound of
every completion/membership window that currently bounds on `sprint.endDate`. Sprint
*selection/filtering* by scheduled date is intentionally left unchanged.

## Background / Motivation

Investigated via the local DB and the Jira API for sprint **DATA/4129**
(`DATA Sprint 12 2026`):

- Scheduled `endDate` = `2026-07-02T16:00Z`; actual `completeDate` = `2026-07-06T00:12Z`
  (sprint held open ~3.5 days past schedule).
- All 8 completed issues transitioned to Done between `2026-07-03T01:16Z` and
  `2026-07-06T00:10Z` — i.e. **before the real close but after the scheduled end**.
- Result: Sprint Detail showed `completedInSprintCount = 0` and every ticket as "Done"
  (current status) but not "Completed" (green ✓), while Jira's own burndown (which uses
  `completeDate`) correctly showed the work finishing as the sprint closed.

Root cause: `sync.service.ts:636` maps `sprint.endDate = s.endDate` and silently drops
`s.completeDate` (already declared at `jira.types.ts:15`); the `JiraSprint` entity and
table have no `completeDate` column; and completion windows across services bound on
`endDate`.

**Impact (measured on the local DB, 5-day proxy window):** 81 closed sprints across all 5
scrum boards have completions in the post-scheduled-end gap — **717 issues** currently
mis-excluded (OCS 430, BPT 98, DATA 92, SPS 69, ACC 28). This is systemic, not a DATA
quirk.

## Scope

**In scope**

- Add nullable `completeDate` column to `JiraSprint` (TypeORM migration, `up()` + `down()`).
- Map `s.completeDate` in `SyncService.syncSprints`.
- Introduce a shared **effective sprint end** helper `completeDate ?? endDate` (then the
  existing `?? now` fallback for active sprints).
- Replace `sprint.endDate` with the effective end at every **completion / membership /
  metric-window upper bound**, specifically (subject to architect confirmation):
  - `sprint/sprint-detail.service.ts` (`sprintWindowEnd`)
  - `planning/planning.service.ts` (completed-transition upper bound)
  - `sprint-membership/sprint-membership.service.ts` (`sprintEnd`)
  - `roadmap/roadmap.service.ts` (in-sprint roadmap classification `sprintEnd`)
  - `gaps/gaps.service.ts` (closed-sprint `windowEnd`)
  - `metrics/metrics.service.ts` (DORA window end when scoped to a specific sprint)
- Align Sprint Detail completion bounds with Planning's `SPRINT_GRACE_PERIOD_MS` (5 min)
  so the two views agree and the Sprint Detail "Completed" tooltip becomes accurate.

**Out of scope**

- Any change to sprint **selection / filtering / bucketing** by scheduled date — these must
  keep using `endDate` (e.g. `WHERE s.endDate <= :quarterEnd`, sprint-overlaps-week query,
  quarter range computation, latest-sprint selection). Changing these would alter which
  sprints appear in a period.
- Changing the **displayed** sprint end field shown in responses (Sprint Detail header,
  Sprint Report) — the architect will decide whether to also surface `completeDate`
  alongside it; default is to leave the displayed scheduled end unchanged.
- A one-off backfill script — `completeDate` repopulates on the next full sync per board.

## Acceptance Criteria

- Given a closed sprint with `completeDate > endDate`, when I view Sprint Detail, then
  issues whose Done-transition is at/before `completeDate` (+ grace) are marked Completed.
- Given sprint DATA/4129 (`completeDate` 2026-07-06T00:12Z) after re-sync, then
  `completedInSprintCount` = **8** (DATA-413/414/415/416/427/430/431/432); DATA-423 (To Do)
  remains not-completed.
- Given the sync runs against a closed sprint, then `JiraSprint.completeDate` is persisted
  from the Jira API response.
- Given a sprint with no `completeDate` (active / never closed), then behaviour is
  unchanged: effective end falls back to `endDate`, then to `now`.
- Planning Accuracy "Completed" uses the effective end (`completeDate ?? endDate`) as its
  upper bound, preserving the existing 5-minute grace.
- Sprint selection/filtering/bucketing queries continue to use scheduled `endDate` (no
  change to which sprints appear in any period).
- A migration adds the nullable `completeDate` column with a working `down()` that drops it.

## Open Questions

1. Should responses that currently expose the scheduled `endDate` (Sprint Detail header,
   Sprint Report list) *also* expose `completeDate` so the UI can show "closed late"? —
   architect to decide; not required to fix the bug.
2. `metrics.service.ts` DORA windows: confirm which of the several `endDate` uses are
   sprint-completion bounds (change) vs quarter-range/selection (leave). The architect
   must enumerate these precisely before implementation.
3. Does `sprint-report.service.ts` compute completion itself, or read from
   Planning/Sprint-Detail? If it only stores/reads, no windowing change is needed there.

## Notes

- `completeDate ?? endDate` (then `?? now`) is the single rule; implement once as a shared
  helper and reuse — do not inline the fallback in each service.
- This changes historical reported numbers for late-closed sprints (by design — they were
  previously undercounting). Call this out in the PR so the shift is expected, not alarming.
- Regression test must pin DATA/4129 → 8 completed, using changelog + `completeDate`
  fixtures, as the canonical example of the bug.
