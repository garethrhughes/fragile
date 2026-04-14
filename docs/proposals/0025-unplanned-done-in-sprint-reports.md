# 0025 — Never-Boarded Tickets in Sprint Reports and Kanban Equivalents

**Date:** 2026-04-14
**Status:** Proposed
**Author:** Architect Agent
**Related ADRs:** None yet — to be created upon acceptance

---

## Problem Statement

There are two distinct categories of "unplanned" work that the tooling needs to surface,
but they are currently conflated under a single name ("Unplanned Done Tickets") and placed
in different parts of the UI with no explanation of the distinction:

1. **Mid-sprint additions** — issues that were on the sprint board at some point but were
   added *after* sprint start. Currently shown as amber rows in the Sprint Detail view
   (`/sprint/[boardId]/[sprintId]`) via the `addedMidSprint` flag on `SprintDetailIssue`.

2. **Never-boarded completions** — issues that were resolved within the sprint window but
   *never appeared on the sprint board at all* (no Sprint-field changelog entry before
   `resolvedAt`). Currently computed by `GapsService.getUnplannedDone()` and:
   - Displayed in a collapsible "Unplanned Done Tickets" section on the Sprint Report page
     (`/sprint-report/[boardId]/[sprintId]`) via `SprintReportResponse.unplannedDone`.
   - Separately displayed on the Gaps page (`/gaps`) in `UnplannedDoneSection`, filterable
     by board and period.

The naming collision creates immediate confusion: both the Sprint Detail page and the Sprint
Report page have a section or signal called "unplanned done", but they refer to different
things. The user's request to show "whole line be red" implies intent to surface never-boarded
completions *inside* the main sprint detail issue table — but that table is sourced from
`SprintDetailService`, which only returns issues that were assigned to the sprint. Never-boarded
issues, by definition, are not in that dataset.

Additionally, Kanban boards have no sprint concept. The `/gaps` Unplanned Done section
already excludes Kanban boards with a "Not available for Kanban boards" message, but there is
no equivalent signal for Kanban never-boarded completions anywhere in the product.

This proposal resolves the naming ambiguity, specifies where and how never-boarded tickets
should appear in sprint-scoped views, and defines the approach for surfacing the equivalent
signal on Kanban boards.

---

## Current State Audit

Before designing changes, the following is confirmed from reading the codebase:

### What already exists

| Surface | Data source | Concept shown |
|---|---|---|
| `/sprint/[boardId]/[sprintId]` — amber rows | `SprintDetailIssue.addedMidSprint` | Mid-sprint additions (were on the board, added after start) |
| `/sprint-report/[boardId]/[sprintId]` — "Unplanned Done Tickets" collapsible | `SprintReportResponse.unplannedDone` from `GapsService.getUnplannedDone()` | Never-boarded completions (not on board at resolution time) |
| `/gaps` — "Unplanned Done Tickets" collapsible | `GET /api/gaps/unplanned-done` → `GapsService.getUnplannedDone()` | Never-boarded completions, selectable by board + period |

### What is missing

1. **Clear labels**: both surfaces say "Unplanned Done Tickets" but mean different things.
2. **Never-boarded tickets in the Sprint Detail view**: the user's request to highlight
   these as red rows in the sprint issues table cannot be satisfied with the current data
   model — `SprintDetailService` only returns issues that are sprint members. A separate
   section is required.
3. **Kanban never-boarded signal**: no UI surface for Kanban boards.

---

## Proposed Solution

### Design Question 1 — Naming clarity

**Decision: rename both concepts with distinct, unambiguous labels.**

| Concept | Old label | New label |
|---|---|---|
| Issues added to the sprint after start (were on the board) | "Unplanned Done" / "Mid-sprint" | **"Late Additions"** |
| Issues completed without ever being on the sprint board | "Unplanned Done Tickets" | **"Never-Boarded Completions"** |

**Rationale:**
- "Late Additions" is already partially expressed in the Sprint Detail page via the "Added
  mid-sprint" column label and "⚠ Mid-sprint" badge; this proposal standardises the label.
- "Never-Boarded Completions" is unambiguous: these tickets completed during the sprint
  window but never appeared on the board. It avoids overloading "unplanned", which is used
  in multiple contexts across the product.
- No schema changes are required for renaming — it is a UI label change only.
- The Gaps page `UnplannedDoneSection` heading also changes to "Never-Boarded Completions"
  for consistency.

> **Note on the `unplannedDone` field in `SprintReportResponse`:** The backend field name
> `unplannedDone` (and the corresponding `UnplannedDoneIssue` type) are internal implementation
> details. They do not need to be renamed in the API contract for this label change to take
> effect — only the UI display strings change. A future refactor proposal may rename these
> if the team decides the API names should mirror the UI labels; that is out of scope here.

---

### Design Question 2 — Where to surface never-boarded tickets in Scrum sprint reports

**Decision: dedicated collapsible section below the sprint issues table, not inline red rows.**

**Rationale for rejecting inline red rows:**

The user's request was "whole line be red." The most natural interpretation is highlighting
rows in the sprint issues table on `/sprint/[boardId]/[sprintId]`. This is architecturally
infeasible without a significant data model change:

- `SprintDetailService.getDetail()` fetches issues via Jira's sprint membership API — it
  only returns issues that belong to the sprint. Never-boarded issues are, by definition,
  not in this dataset.
- Merging never-boarded issues into the `SprintDetailIssue[]` array would require either:
  (a) fetching `GapsService.getUnplannedDone()` in parallel inside `SprintDetailService`
  and introducing a cross-module dependency (GapsModule → SprintModule is already one
  direction; adding SprintDetailService → GapsService creates a dependency risk), or
  (b) joining the results in the frontend, which means the Sprint Detail page fetches two
  APIs and merges heterogeneous issue shapes into the `DataTable`.
- The `SprintDetailIssue` and `UnplannedDoneIssue` types have different fields
  (`addedMidSprint`, `completedInSprint`, `leadTimeDays` vs `resolvedAt`, `resolvedStatus`,
  `priority`, `assignee`). A merged table would need to make many columns optional, reducing
  information density for both issue types.

**Decided approach — Sprint Detail page: new collapsible section**

Add a "Never-Boarded Completions" collapsible section below the sprint issues table on
`/sprint/[boardId]/[sprintId]`. This section:

- Is only shown for **closed sprints** (the sprint must have a defined `endDate` for the
  date-window query to be meaningful; active sprints would produce a partial and potentially
  misleading list).
- Fetches `GET /api/gaps/unplanned-done?boardId=X&sprintId=Y` on the client side, triggered
  when the section is expanded (lazy load on first open).
- Reuses the `UnplannedDoneIssue` type and the existing column definitions from the Gaps
  page, with no new types required.
- Renders as a collapsible with a count badge (e.g. "Never-Boarded Completions (3)"), a
  summary bar (total count, total points, type breakdown), and a `DataTable`.
- The section heading and the "never-boarded" label use the new terminology from Design
  Question 1.
- For **active sprints**: the section is hidden entirely (no section header rendered).

**Decided approach — Sprint Report page: rename existing section**

The Sprint Report page (`/sprint-report/[boardId]/[sprintId]`) already has a
"Never-Boarded Completions" section (currently labelled "Unplanned Done Tickets") embedded
in the report payload via `SprintReportResponse.unplannedDone`. The only change needed is:

- Rename the section heading from "Unplanned Done Tickets" to "Never-Boarded Completions".
- The section header `<h2>` text changes from "Unplanned Work" to "Never-Boarded Completions".
- The collapsible button text changes from "Unplanned Done Tickets (N)" to
  "Never-Boarded Completions (N)".

No backend changes are required for the Sprint Report page.

---

### Design Question 3 — Detection algorithm ("never on the board") reuse

**Decision: reuse `GapsService.getUnplannedDone()` directly — no new algorithm.**

The existing `GapsService.getUnplannedDone(boardId, sprintId)` already implements the
correct changelog-replay algorithm:
- Replays `Sprint`-field changelog entries up to `resolvedAt`.
- Applies the snapshot-sprintId fallback (issues placed in a sprint at creation with no
  changelog).
- Correctly excludes retroactive sprint assignments (changelog after `resolvedAt`).
- Supports sprint-scoped date windows via `sprintId` parameter.

The `SprintReportService` already calls `gapsService.getUnplannedDone(boardId, sprintId)`
as part of `generateReport()`. The Sprint Detail page will call the same endpoint directly
from the frontend (lazy load on section expand). No new service methods are needed.

---

### Design Question 4 — Naming cleanup on the Gaps page

The `/gaps` page `UnplannedDoneSection` component currently uses the heading
"Unplanned Done Tickets". This changes to "Never-Boarded Completions" for consistency.

The other two existing Gaps sections ("Issues without an Epic", "Issues without a story
point estimate") are unchanged.

---

### Design Question 5 — Kanban never-boarded equivalents

Kanban boards have no sprints. The concept of "never in a sprint" does not apply. However,
there is an analogous concept: **issues that were completed without ever being pulled into
any weekly flow window** (i.e. were not tracked in the Kanban weekly view during the period
they were resolved). This is already partially expressed in the Kanban weekly detail view
via the `addedMidWeek` flag on `WeekDetailIssue`, but never-boarded Kanban completions are
a different thing: they never appeared in *any* week's tracked set.

**Options evaluated:**

| Option | Description | Decision |
|---|---|---|
| A | New Kanban Activity Report page, time-windowed, with never-boarded highlighted | Ruled out — too much scope; Kanban weekly view already exists at `/planning/kanban-weeks` |
| B | Extend `/gaps` with a "Kanban Never-Boarded" subsection | Favoured |
| C | Dashboard widget | Insufficient — no drill-down |
| D | Extend existing Kanban weekly view | Wrong surface — weekly view shows what happened in a given week; this is a cross-week hygiene signal |

**Decision: Option B — extend `/gaps` with a Kanban Never-Boarded subsection.**

**What constitutes a Kanban "never-boarded" completion:**

A Kanban issue is classified as never-boarded if:
- `boardType = 'kanban'`
- It is a work item (`isWorkItem` — excludes Epics and Sub-tasks)
- It reached a done status within the requested date window
- It has **no `boardEntryDate`** (i.e. `jira_issues.boardEntryDate IS NULL` or `boardEntryDate`
  is after `resolvedAt`) — it was never formally pulled onto the Kanban board's tracked flow

> **Note:** `boardEntryDate` is already stored in `jira_issues` and populated by
> `SyncService` for Kanban boards (it is used by `PlanningService` and `WeekDetailService`).
> A null `boardEntryDate` means the issue was never seen entering the board's In Progress
> column; it went directly from created/backlog to Done without being tracked.

**New endpoint:**

```
GET /api/gaps/kanban-never-boarded?boardId=PLAT&quarter=2026-Q1
GET /api/gaps/kanban-never-boarded?boardId=PLAT
```

This endpoint mirrors the shape of `GET /api/gaps/unplanned-done` and reuses the same
`UnplannedDoneIssue` / `UnplannedDoneResponse` response types (with `resolvedAt` populated
from the status changelog, and `resolvedStatus` from the board's `doneStatusNames`).

The endpoint **requires** a `boardId` and **rejects Scrum boards** with HTTP 400.

For "all Kanban boards" aggregation: the frontend uses the existing All Boards chip (which
already filters to all boards); the backend iterates all `boardType = 'kanban'` configs
when `boardId` is absent or `'all'`.

**Frontend: new "Kanban Never-Boarded Completions" collapsible on the Gaps page.**

The new section sits below the existing "Never-Boarded Completions" (Scrum) section on
`/gaps`. It has its own board selector filtered to Kanban boards only, plus a period
selector (quarter / last 90 days — no sprint mode, since Kanban boards have no sprints).

---

### Design Question 6 — API changes summary

| Change | Type | Detail |
|---|---|---|
| `GET /api/gaps/unplanned-done` | No change | Already implemented; Sprint Detail page calls it directly |
| `GET /api/gaps/kanban-never-boarded` | New endpoint | New route on `GapsController`; new `getKanbanNeverBoarded()` method on `GapsService` |
| `GET /api/sprint-report/:boardId/:sprintId` | No change | Response shape unchanged; only UI labels change |
| `GET /api/sprints/:boardId/:sprintId/detail` | No change | Response shape and data unchanged |

---

### Design Question 7 — Visual design

**Sprint Detail page — "Never-Boarded Completions" section:**

The section renders as a collapsible panel below the sprint issues table. It intentionally
does *not* use red rows — that affordance is already reserved for incidents and failures
in the sprint detail `rowClassName`. Adding a third red-row concept would create ambiguity.

Instead:
- The collapsible header uses a **red left border accent** (Tailwind: `border-l-4 border-red-400`)
  to signal that these are concerning items, while maintaining visual separation from the
  sprint's own issue list.
- Inside the section, the `DataTable` rows for never-boarded issues use a **red-50 row
  background** (`bg-red-50`) — this is a contained red affordance within a clearly labelled
  section, and does not conflict with the sprint table's own row colouring.

This satisfies the spirit of the "whole line be red" request while maintaining information
hierarchy.

**Section placement order on Sprint Detail page:**

1. Summary stat chips (existing)
2. Sprint issues table (existing, with amber rows for late additions)
3. **"Never-Boarded Completions" collapsible (new)** — only shown for closed sprints
4. No other changes to the page layout

**Section placement order on Sprint Report page:**

1. Composite score + band (existing)
2. Dimension scores grid (existing)
3. Score trend chart (existing)
4. Recommendations (existing)
5. **"Never-Boarded Completions" collapsible (rename of existing "Unplanned Work" section)**

---

## Data Flow

### Sprint Detail page — never-boarded section

```
User opens /sprint/ACC/123  (closed sprint)
  └─ SprintDetailService.getDetail(ACC, 123) → SprintDetailResponse (sprint members only)
     └─ Rendered immediately as main issues table

User expands "Never-Boarded Completions" section (first expand only)
  └─ Frontend calls GET /api/gaps/unplanned-done?boardId=ACC&sprintId=123
     └─ GapsService.getUnplannedDone(ACC, 123)
        └─ Replays status + Sprint changelogs for window [sprint.startDate, sprint.endDate]
           └─ Returns UnplannedDoneResponse
  └─ Rendered as DataTable with bg-red-50 rows
```

### Kanban Gaps section

```
User opens /gaps, expands "Kanban Never-Boarded Completions"
  └─ Board selector: Kanban boards only
  └─ Period selector: last90 | quarter
  └─ Frontend calls GET /api/gaps/kanban-never-boarded?boardId=PLAT&quarter=2026-Q1
     └─ GapsService.getKanbanNeverBoarded(PLAT, quarter=2026-Q1)
        └─ Finds work items where boardEntryDate IS NULL or boardEntryDate > resolvedAt
           AND resolvedAt within window
        └─ Returns UnplannedDoneResponse (same shape)
  └─ Rendered as DataTable (no red rows — these are informational, not sprint-critical)
```

---

## Affected Files

### Backend (changes and additions)

```
backend/src/gaps/
  gaps.controller.ts          MODIFIED — add GET /gaps/kanban-never-boarded route
  gaps.service.ts             MODIFIED — add getKanbanNeverBoarded() method
  gaps.service.spec.ts        MODIFIED — add tests for getKanbanNeverBoarded()
  dto/
    kanban-never-boarded-query.dto.ts  NEW
```

No changes to `SprintReportService`, `SprintDetailService`, or any module files.

### Frontend (changes and additions)

```
frontend/src/
  lib/
    api.ts                    MODIFIED — add getKanbanNeverBoarded() wrapper + params type
  app/
    sprint/[boardId]/[sprintId]/
      page.tsx                MODIFIED — add NeverBoardedSection component; show for closed sprints only
    sprint-report/[boardId]/[sprintId]/
      page.tsx                MODIFIED — rename "Unplanned Work" → "Never-Boarded Completions";
                                          rename UnplannedDoneSection button text
    gaps/
      page.tsx                MODIFIED — add KanbanNeverBoardedSection; rename "Unplanned Done Tickets" → "Never-Boarded Completions"
      unplanned-done-section.tsx  MODIFIED — rename heading text only; no logic changes
      kanban-never-boarded-section.tsx  NEW — mirrors UnplannedDoneSection with Kanban board filter
```

---

## Alternatives Considered

### Alternative A — Inline red rows in the sprint issues table

Add never-boarded issues as additional rows in the `DataTable` on the Sprint Detail page,
highlighted in red.

**Why ruled out:**

- `SprintDetailIssue` and `UnplannedDoneIssue` have different field shapes. A merged table
  would need extensive `undefined` handling and would dilute the information density of
  the sprint member columns (`addedMidSprint`, `completedInSprint`, `leadTimeDays`, etc.).
- The red row affordance is already used for incidents and failures. Adding a third
  semantically different red-row type creates visual noise.
- The `SprintDetailService` data pipeline is already complex. Injecting `GapsService`
  into it (or calling both from the frontend and merging) adds fragility without justification.
- A separate, clearly-labelled collapsible section communicates the semantic distinction
  more clearly than a mixed-type table.

### Alternative B — Add never-boarded issues to the sprint report payload only

Leave the Sprint Detail page unchanged and rely solely on the Sprint Report page for
never-boarded visibility.

**Why ruled out:**

- The Sprint Report is only available for *closed* sprints and is a generated/cached
  artefact. Managers monitoring an active sprint have no way to see never-boarded
  completions mid-sprint via the current tooling. A lazy-loaded section on the Sprint
  Detail page provides this without any backend changes.
- The Sprint Report page is already correct — it has the section. This alternative would
  leave a gap in the Sprint Detail view that the user has specifically asked about.

### Alternative C — Kanban: new dedicated page `/planning/kanban-never-boarded`

A standalone Kanban never-boarded report page, separate from `/gaps`.

**Why ruled out:**

- The `/gaps` page is the established home for cross-board hygiene signals. Adding a new
  top-level route for a single Kanban signal inflates navigation complexity.
- The Gaps page already has the board selector + period selector pattern; the Kanban
  section reuses this exactly.
- A dedicated page could be a follow-up if the Kanban never-boarded signal becomes
  high-volume or requires deeper filtering.

### Alternative D — Rename `unplannedDone` backend field to `neverBoardedCompletions`

Rename the API response field at the same time as the UI labels.

**Why ruled out:**

- `SprintReportResponse.unplannedDone` is stored in the `sprint_reports.payload` JSONB
  column. Renaming it would break deserialization of all existing cached reports.
- The `UnplannedDoneIssue` type is shared between the Gaps page and the Sprint Report
  page; renaming it is a mechanical refactor with no semantic benefit at this stage.
- Deferring the API rename until the payload caching strategy is revisited (e.g. when a
  proposal addresses stored-report schema versioning) is the safer path.

---

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Database | None | No schema changes. `boardEntryDate` already exists in `jira_issues` for Kanban boards. |
| API contract | Additive | New `GET /api/gaps/kanban-never-boarded` endpoint. All existing endpoints unchanged. |
| Frontend | Multiple file edits | Sprint Detail page: new lazy-loaded collapsible section. Sprint Report page: label rename only. Gaps page: label rename + new Kanban section component. |
| Tests | New unit tests | `GapsService.getKanbanNeverBoarded()` needs cases for: Scrum board → throws; null boardEntryDate → unplanned; boardEntryDate after resolvedAt → unplanned; boardEntryDate before resolvedAt → planned; outside window → excluded; Epic/sub-task → excluded. |
| Jira API | No new calls | All data sourced from local Postgres. |
| Performance | Low | `getKanbanNeverBoarded()` is a single issue query + status changelog bulk load per board. No changelog replay loop (boardEntryDate is a stored column). |
| Sync | None | No sync changes required. |
| Naming / UX | Intentional breaking change | "Unplanned Done Tickets" heading renamed to "Never-Boarded Completions" on Gaps page and Sprint Report page. Existing data is unaffected; only display labels change. |

---

## Edge Cases

### 1. Active sprints — never-boarded section on Sprint Detail page

The "Never-Boarded Completions" section is **not rendered** for active sprints. The reason:
the date window is `[sprint.startDate, now]`, which changes every time the page loads, and
the result set would grow continuously through the sprint. This could mislead managers into
thinking a ticket was forgotten if it simply hasn't been resolved yet. The section is shown
only for closed sprints where the window is fixed and the result is stable.

### 2. Kanban `boardEntryDate` is null by default

New Kanban boards, or boards that have only recently been added to the system, may have all
`boardEntryDate = null` because no sync has occurred yet that populates the field.
`getKanbanNeverBoarded()` would return all resolved issues as "never-boarded", which is
misleading. The service must check whether **any** issue on the board has a non-null
`boardEntryDate` — if none do, return an empty result with a `dataQualityWarning` flag in
the response. The frontend shows an informational message: "Board entry dates are not yet
available for this board — run a sync and try again."

### 3. Kanban boards where all completions are legitimately never-boarded

Some Kanban boards are used as ad-hoc queues where issues are created and immediately
resolved without formal board tracking. In this case the "never-boarded" signal is 100%
of completions and has low diagnostic value. This is a data quality issue, not a product
bug. The section still shows results; managers can draw their own conclusions. No special
handling required.

### 4. Retroactive sprint assignment (already handled)

Covered by `GapsService.getUnplannedDone()` — the changelog replay caps at `resolvedAt`.
No change required. See proposal 0024 §Edge Case 3.

### 5. Never-boarded section fetch error on Sprint Detail page

If the `GET /api/gaps/unplanned-done` call fails when the user expands the section, the
section shows an inline error state ("Could not load never-boarded completions.") with a
retry button. The sprint issues table above is unaffected.

### 6. Sprint Detail page — never-boarded section for a sprint with zero never-boarded issues

The section is still rendered (for closed sprints) with a count badge of 0. When expanded,
it shows "No never-boarded completions for this sprint." This is a positive signal (all
resolved work was on the board) and should be visible.

---

## Out of Scope

- **Renaming backend fields** (`unplannedDone`, `UnplannedDoneIssue`): deferred pending
  a stored-report schema versioning proposal.
- **Never-boarded metric in the Sprint Report composite score**: whether the count of
  never-boarded completions should factor into the sprint composite score (as a negative
  signal) is a scoring design question for a separate proposal.
- **Cross-sprint trending of never-boarded rate**: a chart showing never-boarded % over
  time is valuable but out of scope for this proposal.
- **Pagination**: the `DataTable` component does not paginate. For busy boards with many
  never-boarded issues, scrolling is accepted for now.
- **Kanban never-boarded in the Sprint Report page**: Kanban boards do not have sprint
  reports; this combination does not apply.

---

## Open Questions

1. **Section visibility on Sprint Detail for active sprints.** The proposal hides the
   section entirely. An alternative is to show it but with a disclaimer ("Results may be
   incomplete — sprint is still active"). Which is preferred?

2. **`dataQualityWarning` flag for Kanban boards.** Should this be a boolean field on
   `UnplannedDoneResponse`, or a separate response variant? Adding it to the shared
   response type is the simplest option but adds a field that is always `false` for Scrum
   boards. A union type is more correct but adds complexity to the frontend.

3. **"Never-Boarded Completions" vs "Ghost Completions" vs "Off-Board Completions".** The
   chosen label is descriptive but long. Does the team prefer a shorter label?

4. **Sprint Report page re-generation.** Renaming the section heading on the Sprint Report
   page is a frontend-only change (the stored `payload.unplannedDone` field name is
   unchanged). However, the displayed section title "Unplanned Work" changes to
   "Never-Boarded Completions" immediately for all cached reports without re-generation.
   Is this acceptable, or should re-generation be triggered? Recommendation: accept the
   immediate rename — no data changes, only the display label.

---

## Acceptance Criteria

### Naming

- [ ] The Sprint Detail page collapsible section is labelled "Never-Boarded Completions".
- [ ] The Sprint Report page section heading is "Never-Boarded Completions" (renamed from
      "Unplanned Work" / "Unplanned Done Tickets").
- [ ] The Gaps page `UnplannedDoneSection` heading is "Never-Boarded Completions" (renamed
      from "Unplanned Done Tickets").
- [ ] The Sprint Detail page column label for `addedMidSprint` remains "Scope creep" /
      "Added mid-sprint" — no changes to the mid-sprint additions concept.

### Sprint Detail page — Never-Boarded Completions section

- [ ] The "Never-Boarded Completions" section is rendered only when `sprint.state === 'closed'`.
- [ ] The section is not rendered (not even an empty header) for active or future sprints.
- [ ] On first expand, the section calls `GET /api/gaps/unplanned-done?boardId=X&sprintId=Y`
      and displays a loading spinner until the response arrives.
- [ ] Subsequent expands (collapse → expand) do not re-fetch; the result is cached in
      component state.
- [ ] When `issues.length > 0`, the section renders a summary bar (total count, total points,
      type breakdown) and a `DataTable` with `bg-red-50` row background.
- [ ] When `issues.length === 0`, the section shows "No never-boarded completions for this
      sprint." — the section header is still visible with a count badge of (0).
- [ ] On fetch error, the section shows an inline error message with a retry button.
- [ ] The section has a red left-border accent (`border-l-4 border-red-400`) on the
      collapsible header to distinguish it visually from the sprint's own issue list.
- [ ] The `DataTable` columns are: Issue (linked), Summary, Type, Resolved Status, Resolved
      date, Points, Epic, Priority, Assignee.

### Sprint Report page

- [ ] The section heading renders as "Never-Boarded Completions" (not "Unplanned Work").
- [ ] The collapsible button text renders as "Never-Boarded Completions (N)".
- [ ] All existing sprint report data, scores, recommendations, and trend chart are
      unchanged.

### Gaps page

- [ ] The existing "Unplanned Done Tickets" section heading is renamed to
      "Never-Boarded Completions".
- [ ] A new "Kanban Never-Boarded Completions" collapsible section is added below the
      existing "Never-Boarded Completions" section.
- [ ] The Kanban section's board selector shows only Kanban boards (Scrum boards excluded).
- [ ] The Kanban section's period selector offers "Last 90 days" and "Quarter" only
      (no Sprint mode).
- [ ] Selecting a Scrum board in the Kanban section is not possible (Scrum boards not
      offered in the board selector).

### Backend — `GET /api/gaps/kanban-never-boarded`

- [ ] Returns HTTP 400 for a Scrum board `boardId`.
- [ ] Returns `UnplannedDoneResponse` shape (same as `/api/gaps/unplanned-done`).
- [ ] An issue with `boardEntryDate = null` AND `resolvedAt` within window is classified
      as never-boarded.
- [ ] An issue with `boardEntryDate > resolvedAt` AND `resolvedAt` within window is
      classified as never-boarded (board entry was after completion).
- [ ] An issue with `boardEntryDate <= resolvedAt` within window is **not** classified as
      never-boarded (was on the board before completion).
- [ ] Epics and Sub-tasks are excluded.
- [ ] When no issues on the board have a non-null `boardEntryDate`, the response includes
      `dataQualityWarning: true` and `issues: []`.
- [ ] Issues are sorted `resolvedAt DESC`, then `key ASC`.
- [ ] Unit tests cover all classification cases above.

### No regressions

- [ ] `GET /api/gaps/unplanned-done` behaviour is unchanged.
- [ ] `GET /api/gaps` (noEpic / noEstimate) behaviour is unchanged.
- [ ] `GET /api/sprint-report/:boardId/:sprintId` response shape is unchanged.
- [ ] `GET /api/sprints/:boardId/:sprintId/detail` response shape is unchanged.
- [ ] No new npm dependencies introduced in frontend or backend.
