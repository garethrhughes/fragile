# 0012 — Roadmap Coverage Semantics: Per-Issue Delivery Against Target Date

**Date:** 2026-04-12
**Status:** Accepted
**Author:** Architect Agent
**Related ADRs:** To be created upon acceptance

---

## Problem Statement

The current implementation classifies a sprint issue as `in-scope` (green tick,
counts toward roadmap coverage %) if the issue's epic is linked to a JPD idea whose
**date window overlaps the sprint window** — the `filterIdeasForWindow` predicate in
`roadmap.service.ts`. This framing is wrong.

The correct question is not *"was the roadmap idea active during this sprint?"* but
*"was this issue delivered on time against the roadmap commitment?"* The unit of
analysis is **per-issue** × **target date**, not per-idea × sprint-window-overlap.

Under the current frame, an idea whose `targetDate` expired before the sprint started
can still mark issues as `in-scope` (green), inflating coverage and masking late
delivery. Equally, `isIssueEligibleForRoadmapItem` adds a second overlap check
(activity-start ≤ targetDate) that becomes redundant and confusing under the new frame.

The user-confirmed semantic is:

| Condition | `roadmapStatus` | Counts toward coverage %? |
|---|---|---|
| Epic linked to JPD idea **AND** issue completed on or before `targetDate` | `in-scope` (green ✓) | Yes |
| Epic linked to JPD idea **BUT** issue not completed, or completed after `targetDate` | `linked` (amber ✓) | No |
| No roadmap link | `none` (—) | No |

"Roadmap coverage %" therefore measures: **of all sprint issues linked to a roadmap
idea, what fraction were actually delivered on time?**

---

## Proposed Solution

### Core classification logic

The per-issue classification is computed once we know:
1. Which JPD idea (if any) is linked to the issue's epic — this is a simple lookup
   by `epicKey` across all loaded JPD ideas (no date filter needed at the idea level).
2. The issue's `resolvedAt` timestamp — already computed in both services.
3. The idea's `targetDate`.

```
for each issue in sprint:
  idea = findIdeaByEpicKey(issue.epicKey)   // first matching idea, or null
  if idea is null:
    roadmapStatus = 'none'
  else:
    resolvedAt = firstDoneTransitionTimestamp(issue)  // null if not yet done
    deliveredOnTime = resolvedAt !== null
                      AND resolvedAt <= endOfDay(idea.targetDate)
    roadmapStatus = deliveredOnTime ? 'in-scope' : 'linked'
```

`endOfDay(targetDate)` means `targetDate` extended to `23:59:59.999 UTC`.
This preserves the existing intent of covering the full calendar day of the
commitment deadline (an issue resolved at 17:00 UTC on the target date is on time).

### Change 1 — `sprint-detail.service.ts`: replace window-overlap with per-issue delivery check

**Current block (lines 408–446)** builds `inScopeEpicKeys` and `linkedEpicKeys` by
checking whether each idea's date window overlaps the sprint window.

**Replacement:** build a single flat map from `epicKey → RoadmapItemWindow` with no
date filtering (every idea with both dates and at least one delivery epic key is
included). Then, in the per-issue annotation loop, evaluate delivery against
`resolvedAt` (already computed on lines 516–521).

```typescript
// After loading jpdIdeas (Query 6 / 7 block):

// Build epicKey → idea map (no date-window filter; conflict = keep later targetDate)
const epicIdeaMap = new Map<string, { targetDate: Date }>();
for (const idea of jpdIdeas) {
  if (!idea.deliveryIssueKeys || idea.targetDate === null) continue;
  for (const epicKey of idea.deliveryIssueKeys.filter(Boolean)) {
    const existing = epicIdeaMap.get(epicKey);
    if (!existing || idea.targetDate > existing.targetDate) {
      epicIdeaMap.set(epicKey, { targetDate: idea.targetDate });
    }
  }
}

// In the per-issue annotation loop, replace the current roadmapStatus block:
let roadmapStatus: 'in-scope' | 'linked' | 'none' = 'none';
if (issue.epicKey !== null) {
  const idea = epicIdeaMap.get(issue.epicKey);
  if (idea) {
    // Extend targetDate to end-of-calendar-day (idea deadline covers full day)
    const targetEndOfDay = new Date(idea.targetDate);
    targetEndOfDay.setUTCHours(23, 59, 59, 999);

    const resolvedDate = doneTransition?.changedAt ?? null;  // already computed above
    const deliveredOnTime =
      resolvedDate !== null && resolvedDate <= targetEndOfDay;

    roadmapStatus = deliveredOnTime ? 'in-scope' : 'linked';
  }
}
```

Note: `doneTransition` is already available at this point in the per-issue loop
(lines 516–521 compute it for `resolvedAt`). No additional query is needed — Query 5
already loads **all** status changelogs for sprint issues with no date restriction
(`cl.changedAt` is unrestricted), so `doneTransition` covers all-time history.

### Change 2 — `roadmap.service.ts` `calculateSprintAccuracy`: replace window filter with per-issue delivery check AND expand changelog scope

**Current flow:**
1. `filterIdeasForWindow(allIdeas, sprintStart, sprintEnd)` → `activeIdeas` map
2. `completionDates` populated only for issues whose current status is **not** done
   (`needsChangelogCheck` restriction, lines 711–741)
3. For each issue: check `activeIdeas.has(epicKey)` then call `isIssueEligibleForRoadmapItem`

**Replacement:** build the same `epicIdeaMap` (no date filter, conflict = later
targetDate), expand the changelog query to cover **all** sprint issues (removing the
`needsChangelogCheck` restriction), then classify each issue against `resolvedAt`.

#### 2a — Remove the `needsChangelogCheck` restriction

Issues already in done status at sync time are excluded from the current changelog
query, leaving `completionDates.get(key) === undefined` for them. Under the new
semantic that causes a false-negative: the issue falls into `linked` (amber) even if
it completed before `targetDate`. Fix by querying changelogs for **all** sprint
issues unconditionally.

```typescript
// BEFORE (lines 711-741) — skips already-done issues:
const needsChangelogCheck: string[] = [];
for (const issue of filteredIssues) {
  if (doneStatusNames.includes(issue.status)) {
    completedKeys.add(issue.key);          // done status assumed; no timestamp
  } else {
    needsChangelogCheck.push(issue.key);   // only non-done issues get a query
  }
}
if (needsChangelogCheck.length > 0) {
  const changelogs = await this.changelogRepo
    .createQueryBuilder('cl')
    .where('cl.issueKey IN (:...keys)', { keys: needsChangelogCheck })
    // ... date-scoped to sprint window ...
    .getMany();
  // populate completionDates from changelogs
}

// AFTER — query all filtered issues, no needsChangelogCheck split:
const allFilteredKeys = filteredIssues.map((i) => i.key);
const changelogs = await this.changelogRepo
  .createQueryBuilder('cl')
  .where('cl.issueKey IN (:...keys)', { keys: allFilteredKeys })
  .andWhere('cl.field = :field', { field: 'status' })
  .orderBy('cl.changedAt', 'ASC')  // no date filter — all-time history needed
  .getMany();

const completionDates = new Map<string, Date>();
for (const cl of changelogs) {
  if (cl.toValue !== null && doneStatusNames.includes(cl.toValue)) {
    if (!completionDates.has(cl.issueKey)) {
      completionDates.set(cl.issueKey, cl.changedAt);   // first done transition wins
    }
  }
}
// completedKeys is no longer needed as a separate Set; derive from completionDates
```

Note: the date-range restriction (`changedAt >= sprintStart AND changedAt <= sprintEnd`)
is also removed. An issue completed before the sprint started (carried over from a
prior sprint) should still get its true `resolvedAt` so delivery-against-targetDate
is calculated correctly.

#### 2b — Replace the covered-issues filter

```typescript
// Replace filterIdeasForWindow call + isIssueEligibleForRoadmapItem call:

// Build epicKey → targetDate map (no window filter)
const epicIdeaMap = buildEpicIdeaMap(allIdeas);  // extracted private helper

// In the covered-issues filter:
const coveredIssues = filteredIssues.filter((issue) => {
  if (issue.epicKey === null) return false;
  const idea = epicIdeaMap.get(issue.epicKey);
  if (!idea) return false;

  const targetEndOfDay = endOfDayUTC(idea.targetDate);

  // An issue is 'covered' (green) only if it was completed on or before targetDate.
  const resolvedAt = completionDates.get(issue.key) ?? null;
  return resolvedAt !== null && resolvedAt <= targetEndOfDay;
});
```

### Change 3 — `roadmap.service.ts`: `roadmapDeliveryRate` → `roadmapOnTimeRate`

**Decision (Open Question 1):** Under the new semantic, `coveredIssues` (green) are
already the on-time completions, making the old formula
`linkedCompletedIssues / coveredCount` a near-tautology. The field is repurposed as:

```
roadmapOnTimeRate = onTimeDeliveries ÷ totalLinkedIssues
                  = green ÷ (green + amber)
```

This shows the fraction of roadmap-linked work that landed on time. It provides
meaningful signal even when `totalIssues` is large and coverage % is low.

**Required changes:**

1. **`backend/src/roadmap/roadmap.service.ts`** — rename field in `RoadmapSprintAccuracy`
   interface and update all three assignment sites:

   ```typescript
   // In the RoadmapSprintAccuracy interface:
   // Before:
   roadmapDeliveryRate: number;
   // After:
   roadmapOnTimeRate: number;

   // In calculateSprintAccuracy return value:
   const totalLinkedIssues = coveredIssues.length       // green
                            + linkedNotCoveredCount;    // amber (linked but not on time)
   const roadmapOnTimeRate =
     totalLinkedIssues > 0
       ? Math.round((coveredIssues.length / totalLinkedIssues) * 10000) / 100
       : 0;
   // ...
   return { ..., roadmapOnTimeRate, ... };
   ```

   The two Kanban paths (`getKanbanAccuracy`, `getKanbanWeeklyAccuracy`) that also
   populate `roadmapDeliveryRate` must be updated to `roadmapOnTimeRate` in the same
   rename pass. Their formula can be updated to the new semantic at the same time or
   remain as-is with the field renamed — the rename is the minimum required change to
   keep the interface consistent.

2. **`frontend/src/lib/api.ts`** — rename `roadmapDeliveryRate: number` →
   `roadmapOnTimeRate: number` in the `RoadmapAccuracyRow` (or equivalent) type.

3. **`frontend/src/app/roadmap/page.tsx`** — rename all references to
   `roadmapDeliveryRate` → `roadmapOnTimeRate` (approximately 8 occurrences including
   `key:` references in column definitions, `.reduce()` accumulator, and chart data
   mappers).

4. **`frontend/src/app/planning/page.tsx`** — rename the single
   `r.roadmapDeliveryRate` reference → `r.roadmapOnTimeRate`.

### Change 4 — `roadmap.service.ts`: fate of `filterIdeasForWindow`

`filterIdeasForWindow` currently serves two roles:
1. **Sprint accuracy path** (`calculateSprintAccuracy`): replaced by Change 2 above.
2. **Kanban quarter/week paths** (`getKanbanAccuracy`, `getKanbanWeeklyAccuracy`):
   these paths group issues by the quarter/week they entered the board, then ask which
   ideas were "active" in that window. See the Kanban section below.

Under the new sprint semantic, `filterIdeasForWindow` is **no longer called** from
`calculateSprintAccuracy`. Whether it is retained for the Kanban paths depends on
the Kanban decision (below). If retained, remove the EOD extension and note its
scope is now Kanban-only.

### Change 5 — `roadmap.service.ts`: retire `isIssueEligibleForRoadmapItem`

This private method implements an activity-window overlap check
(`issueActivityStart ≤ targetDate AND issueActivityEnd ≥ startDate`). It was
designed to exclude issues that were worked on entirely outside the idea's window.
Under the new per-issue delivery semantic, this check is replaced by a single
`resolvedAt ≤ targetEndOfDay` test. The method can be deleted when both the sprint
path and Kanban paths no longer reference it.

### Change 6 — `roadmapLinkedCount` summary field

Currently counts `roadmapStatus === 'in-scope'` (line 585 of `sprint-detail.service.ts`).
Under the new semantic, the natural read of "roadmap-linked" in the summary bar is the
count of issues with *any* roadmap link — green or amber — i.e.,
`roadmapStatus !== 'none'`. This gives the engineer a clearer picture:
"N issues are on the roadmap; of those, M were delivered on time."

Proposed change:

```typescript
// Before:
roadmapLinkedCount: issues.filter((i) => i.roadmapStatus === 'in-scope').length,

// After:
roadmapLinkedCount: issues.filter((i) => i.roadmapStatus !== 'none').length,
```

The frontend `StatChip` label is already "Roadmap-linked", which matches this wider
count. No frontend template change is needed, only the filter expression.

### Coverage % formula

`roadmapCoverage = coveredIssues / totalIssues` is unchanged in shape. The meaning
of `coveredIssues` changes from "issues linked to an active idea" to "issues linked
to any idea AND delivered on time." `totalIssues` remains all work-item issues in
the sprint.

---

## Kanban / Weekly Accuracy Paths

The Kanban paths (`getKanbanAccuracy`, `getKanbanWeeklyAccuracy`) group issues by the
quarter or week they entered the board, then compute coverage using:

1. `filterIdeasForWindow(allIdeas, windowStart, windowEnd)` to select "active" ideas
2. `isIssueEligibleForRoadmapItem` on each issue

The correct analogue to the new sprint semantic for Kanban would be:
*an issue is covered (green) if its epic is linked to any idea AND it was completed
on or before that idea's `targetDate`, regardless of which quarter/week bucket it
belongs to.*

However, this change to the Kanban paths:
- Interacts with the `linkedToRoadmap: boolean` field on `WeekDetailIssue` /
  `QuarterDetailIssue` (a simple boolean, not the three-state `roadmapStatus` union)
- Requires an audit of whether `WeekDetailIssue.linkedToRoadmap` needs to become
  a three-state value like `SprintDetailIssue.roadmapStatus`
- May need a separate proposal for the Kanban detail view upgrade

**Decision:** The Kanban path change is scoped to a separate proposal. The immediate
work in this proposal covers the sprint accuracy path and sprint detail service only.
`filterIdeasForWindow` and `isIssueEligibleForRoadmapItem` remain in use for the
Kanban paths until that follow-up proposal is accepted.

---

## Alternatives Considered

### Alternative A — Keep window-overlap; tighten the start-of-day boundary

Proposal 0012 (original draft) fixed a boundary bug (same-calendar-day = expired)
without changing the fundamental date-window frame. This correctly handled the
PT-389 / BPT Sprint 4 case but still classified issues as green based on window
overlap rather than actual delivery. An issue in an idea's window that was never
completed still showed green — coverage could be 100% even if nothing shipped.
Ruled out: the window-overlap frame is fundamentally the wrong question.

### Alternative B — Two-pass: window-overlap for `linked`, delivery check for `in-scope`

Keep the window-overlap to determine `linked` (amber), then additionally require
`resolvedAt ≤ targetDate` to promote to `in-scope` (green). This preserves the
idea of "is this sprint working toward a roadmap commitment?" separately from
"did it deliver?".

Ruled out: the user confirmed the simpler frame — `in-scope` means delivered on time,
regardless of whether the sprint started before or after the idea's own start date.
The two-pass approach adds complexity without matching the stated semantic.

### Alternative C — `roadmapDeliveryRate` as coverage % alias (drop the field)

Under the new semantic `coveredCount / totalIssues` (coverage %) and
`linkedCompleted / covered` would both converge to the same numerator. The field
could simply be dropped from the response.

Ruled out: retaining the field as `roadmapOnTimeRate = green / (green + amber)`
provides distinct and useful signal — "of issues the team committed to the roadmap,
what share landed on time?" — that `roadmapCoverage` (green / all sprint issues)
does not directly express.

---

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Database | None | Pure logic change. No entity or migration changes. |
| API contract | Field renamed | `roadmapDeliveryRate` → `roadmapOnTimeRate` in `RoadmapSprintAccuracy`. Response shapes otherwise unchanged. `roadmapCoverage`, `roadmapLinkedCount`, and per-issue `roadmapStatus` values will differ for sprints where on-time delivery differs from window overlap. |
| Frontend | Field rename only | `roadmapDeliveryRate` → `roadmapOnTimeRate` in `api.ts`, `roadmap/page.tsx`, and `planning/page.tsx`. No template, layout, or rendering changes required. |
| Tests | Unit and integration tests need updating | Tests covering the window-overlap predicate in `RoadmapService` must be replaced with delivery-check tests. New test cases: issue completed before `targetDate` (green), issue completed after `targetDate` (amber), issue not completed (amber), issue with no epic (dash). New test: issue already in done status at sync time correctly gets `completionDates` entry and is classified green when before `targetDate`. |
| Jira API | No new calls | No new Jira API calls. `resolvedAt` is derived from cached changelog data. |
| Kanban paths | Not changed by this proposal | `filterIdeasForWindow` and `isIssueEligibleForRoadmapItem` remain for Kanban paths pending a follow-up proposal. |
| `roadmapLinkedCount` | Semantic widens | Changes from counting `in-scope` only to counting `in-scope + linked`. Numerically increases (or stays the same) for all sprints. |
| `isIssueEligibleForRoadmapItem` | Removed from sprint paths | Method removed from `calculateSprintAccuracy`; retained (temporarily) for Kanban paths. |
| `filterIdeasForWindow` | Removed from sprint paths | Method no longer called from `calculateSprintAccuracy`; retained for Kanban paths. |

---

## Open Questions

1. **`roadmapDeliveryRate` in `RoadmapSprintAccuracy`:** ~~Under the new semantic,
   `coveredIssues` (green) = on-time completions, and
   `linkedCompletedIssues / coveredIssues` is therefore a tautology (100% by definition
   when `coveredIssues > 0`). Should `roadmapDeliveryRate` be repurposed to mean
   `coveredIssues / totalLinkedIssues` (on-time fraction of all roadmap-linked issues),
   or dropped?~~

   **Resolved:** Rename field to `roadmapOnTimeRate`. New formula:
   `onTimeDeliveries ÷ totalLinkedIssues` = green ÷ (green + amber).
   This shows the fraction of roadmap-linked work that landed on time. Update
   `RoadmapSprintAccuracy` in `roadmap.service.ts` and the matching type in
   `frontend/src/lib/api.ts` (with downstream updates in `roadmap/page.tsx` and
   `planning/page.tsx`).

2. **`completionDates` coverage in `calculateSprintAccuracy`:** ~~The current
   `completionDates` map is populated only for issues that were *not* already in done
   status at sync time (the `needsChangelogCheck` path, lines 723–741). Issues already
   showing as `Done` at sync time have `completionDates.get(key) === undefined`.
   Under the new semantic this causes them to fall into `linked` (amber) even if they
   completed before `targetDate` — a false negative.~~

   **Resolved:** Expand the changelog query in `calculateSprintAccuracy` (and apply
   the same principle in `sprint-detail.service.ts` where `doneTransition` is used)
   to cover **ALL** sprint issues, not just those currently not-done. Remove the
   `needsChangelogCheck` split entirely: query changelogs for all `filteredIssues`
   with no date restriction so that every issue has a reliable `resolvedAt` /
   `completionDate` regardless of its current status at sync time.
   See Change 2a above for the before/after pseudocode.
   Note: `sprint-detail.service.ts` is **already correct** — Query 5 loads all status
   changelogs for sprint issues with no date restriction, so `doneTransition` there
   covers all-time history without modification.

3. **`resolvedAt` timing and `targetDate` timezone:** `resolvedAt` is stored as a UTC
   timestamp; `targetDate` is a date-only value (midnight UTC from Polaris). The
   `endOfDay(targetDate)` extension to `23:59:59.999 UTC` is the correct boundary
   for a UTC-stored completion timestamp. Confirm Polaris always stores `targetDate`
   at midnight UTC (not local-time midnight) before shipping.

4. **Kanban `linkedToRoadmap` boolean:** `WeekDetailIssue` and `QuarterDetailIssue`
   use a flat boolean rather than the three-state union. A follow-up proposal must
   decide whether to upgrade these to `roadmapStatus: 'in-scope' | 'linked' | 'none'`
   for consistency, or keep the boolean as a simplified view.

---

## Acceptance Criteria

- [ ] An issue whose epic is linked to a JPD idea **and** whose `resolvedAt` is on or
      before `idea.targetDate` (end-of-day UTC) shows `roadmapStatus = 'in-scope'`
      (green tick) in the sprint detail view.

- [ ] An issue whose epic is linked to a JPD idea **but** whose `resolvedAt` is after
      `idea.targetDate` shows `roadmapStatus = 'linked'` (amber tick).

- [ ] An issue whose epic is linked to a JPD idea **but** which is not yet completed
      (`resolvedAt = null`) shows `roadmapStatus = 'linked'` (amber tick).

- [ ] An issue with no epic, or whose epic has no JPD idea link, shows
      `roadmapStatus = 'none'` (dash).

- [ ] `roadmapLinkedCount` in the sprint summary counts issues where
      `roadmapStatus !== 'none'` (i.e. green + amber).

- [ ] `roadmapCoverage` in `GET /roadmap/accuracy?boardId=...` counts only
      on-time-delivered issues (green) as the numerator against total sprint issues.

- [ ] An issue that was in done status at sync time (previously excluded from the
      `needsChangelogCheck` path) now has a `completionDates` entry from the expanded
      all-issues changelog query, and is correctly classified as `in-scope` when its
      first done-transition predates `targetDate`. (Resolves Open Question 2.)

- [ ] `roadmapDeliveryRate` is renamed to `roadmapOnTimeRate` in
      `RoadmapSprintAccuracy` (backend interface), `frontend/src/lib/api.ts`,
      `frontend/src/app/roadmap/page.tsx`, and `frontend/src/app/planning/page.tsx`.
      (Resolves Open Question 1.)

- [ ] `roadmapOnTimeRate` is calculated as `green ÷ (green + amber)` — i.e.,
      on-time deliveries divided by total roadmap-linked issues — returning `0` when
      there are no linked issues.

- [ ] `isIssueEligibleForRoadmapItem` is no longer called from the sprint accuracy
      path. It may be retained for Kanban paths or deleted pending the Kanban proposal.

- [ ] `filterIdeasForWindow` is no longer called from `calculateSprintAccuracy`.

- [ ] Existing unit tests for `filterIdeasForWindow`'s window-overlap logic are
      replaced with unit tests for the per-issue delivery check. Test matrix includes:
      completed before target, completed on target day, completed after target,
      not completed, no epic link, issue already done at sync time (was excluded from
      `needsChangelogCheck`).

- [ ] No frontend template, layout, or rendering changes are required beyond the field
      rename. Existing rendering tests pass.

- [ ] The Kanban quarter and weekly accuracy paths are **not** changed by this
      implementation (deferred to a follow-up proposal).
