# 0005 — Kanban Planning Accuracy

**Date:** 2026-04-10
**Status:** Draft
**Author:** Architect Agent
**Related ADRs:** Supersedes [ADR-0005](../decisions/0005-kanban-boards-excluded-from-planning-accuracy.md)
(partial — the principle that sprint-based planning accuracy is inapplicable to Kanban
boards is retained; this proposal defines what _is_ applicable)

---

## Problem Statement

ADR-0005 correctly established that sprint-based "commitment vs. delivery" is semantically
meaningless for Kanban boards and blocked Kanban boards from the Planning page entirely.
However, the PLAT board (and any future Kanban boards) does have meaningful flow data
already cached in Postgres — issue throughput, cycle time reconstructable from status
changelogs, resolution dates, story points, fix versions, and epic linkage. The Quarter
Detail View (Proposal 0004 / ADR-0016) already works for PLAT and returns rich per-issue
data per calendar quarter.

The current UX leaves Kanban users with a dead-end warning on the Planning page and no
drill-path into their quarterly delivery data from that page. This proposal defines:
(1) which flow-based metrics are meaningful substitutes for sprint planning accuracy on
Kanban boards, (2) which can be computed from existing data vs. what would require new
sync fields, (3) how the Planning page UI should adapt when a Kanban board is selected,
and (4) what backend changes (if any) are needed.

---

## Proposed Solution

### Overview: Two-Phase Approach

The core insight is that Kanban planning accuracy should be expressed in **throughput and
flow terms**, not sprint commitment terms. The closest meaningful equivalent to
"commitment vs. delivery" for a Kanban board is:

| Scrum concept | Kanban equivalent |
|---|---|
| Sprint commitment (points at start) | Quarterly throughput (issues + points resolved) |
| Scope change % | Flow efficiency (active work time / elapsed time) — Phase 2 |
| Completion rate | Quarterly delivery rate (issues resolved / issues pulled in) |
| Sprint-over-sprint trend | Quarter-over-quarter trend |

The proposal is split into two phases:

- **Phase 1** — Surfaces quarterly Kanban metrics computable from **already-synced data**.
  No new migrations, no new sync fields. Uses data already available via
  `QuarterDetailService` and `RoadmapService.getKanbanAccuracy()`.
- **Phase 2** — Adds a `resolutionDate` column to `JiraIssue` (one migration), which
  unlocks precise cycle time calculation (creation-to-resolution), flow efficiency, and
  WIP estimation. This is deferred and does not block Phase 1.

---

### Phase 1: Kanban Quarter View in the Planning Page

#### 1.1 — What the Planning Page Does When a Kanban Board Is Selected

When the user selects a Kanban board (currently disabled), the page enters **Kanban mode**:

- The `Sprint` period toggle button is **hidden** (Kanban boards have no sprints). Only
  the `Quarter` period is available.
- The Kanban warning banner is **replaced** by a contextual header: *"Showing quarterly
  flow metrics for [BOARDID]. Sprint planning accuracy is not applicable to Kanban boards."*
- The existing `KANBAN_BOARDS.has(boardId)` guard that prevents selection is **removed**
  from `handleSelectBoard`; Kanban boards become selectable.
- A new API function `getKanbanPlanningQuarters(boardId)` fetches the list of quarters
  with Kanban issues (see §1.3). The quarter list is driven by board-entry date bucketing,
  consistent with `QuarterDetailService` and `RoadmapService.getKanbanAccuracy()`.

#### 1.2 — Kanban Planning Metrics (Phase 1, computable from existing data)

The quarter-mode table for Kanban boards uses the following columns — all derivable from
`QuarterDetailResponse` (already implemented) or a new lightweight summary endpoint:

| Column | Calculation | Data source | Replaces |
|---|---|---|---|
| Quarter | `YYYY-QN` key | Quarter bucketing by board-entry date | Sprint name |
| State | `active` (current quarter) / `closed` | Quarter vs. today | Sprint state |
| Issues Pulled In | `summary.totalIssues` | `QuarterDetailResponse.summary` | Commitment |
| Issues Completed | `summary.completedIssues` | `QuarterDetailResponse.summary` | Completed |
| Delivery Rate % | `completedIssues / totalIssues × 100` | Derived | Completion Rate % |
| Points Pulled In | `summary.totalPoints` | `QuarterDetailResponse.summary` | — |
| Points Completed | `summary.completedPoints` | `QuarterDetailResponse.summary` | — |
| Mid-Quarter Additions | `summary.addedMidQuarter` | `QuarterDetailResponse.summary` | Added |

**Why these metrics are semantically honest:**
- *Issues Pulled In* maps to "what the team took on" — issues pulled off the backlog
  (left "To Do") during the quarter. This is the closest Kanban analog to commitment.
- *Issues Completed* maps to "what the team delivered."
- *Delivery Rate* maps to "completion rate" but is calculated from throughput, not a
  committed scope snapshot. This distinction is surfaced in the UI column label.
- *Mid-Quarter Additions* is already computed by `QuarterDetailService` and indicates
  unplanned demand that entered the queue after the quarter started. This is the Kanban
  analog to "scope change."

**Metrics intentionally omitted from Phase 1:**
- Cycle time (median, p85) — these are already returned by the existing Quarter Detail
  endpoint's DORA section, but `QuarterDetailService` does not currently calculate them.
  Inclusion requires either a new summary endpoint or extending `QuarterDetailResponse`
  (deferred to Phase 2 or as a separate proposal).
- Flow efficiency — requires knowing time-in-status, which requires changelog replay over
  all status transitions per issue (computable but expensive; deferred to Phase 2).
- WIP at quarter start/end — requires a snapshot model or changelog reconstruction;
  deferred to Phase 2.

#### 1.3 — New Backend Endpoint: `GET /api/planning/kanban-quarters/:boardId`

The Scrum quarter list is today derived from sprint start dates
(`PlanningService.getQuarters()`). Kanban boards have no sprints, so a dedicated
endpoint is needed that returns the list of quarters for which a Kanban board has issues,
along with aggregate summary counts.

**Option A** (preferred): Add a new endpoint to `PlanningModule` —
`GET /api/planning/kanban-quarters/:boardId` — that:
1. Validates that the board is Kanban (returns `400` if Scrum).
2. Calls into `QuarterDetailService` (or a shared private helper) to bucket issues by
   board-entry date and return per-quarter summaries.
3. Returns a `KanbanQuarterSummary[]` array (see §1.4 below).

This keeps `PlanningModule` as the single backend owner of planning-related list
endpoints and avoids adding planning-specific logic to `QuarterModule`.

**Option B**: Reuse `GET /api/quarters/:boardId/:quarter/detail` per quarter and derive
the quarter list client-side by calling the roadmap endpoint
(`GET /api/roadmap/accuracy?boardId=PLAT`) which already returns per-quarter rows for
Kanban boards. However, `RoadmapSprintAccuracy` does not include the point and
mid-quarter-addition fields needed for the planning table, and coupling the Planning page
to the Roadmap endpoint is a module boundary violation.

**Decision: Option A.** The new endpoint is narrow, does not duplicate existing data
pipelines, and maintains clear module ownership.

#### 1.4 — Response DTO: `KanbanQuarterSummary`

```typescript
// backend/src/planning/dto/kanban-quarter-summary.dto.ts

export interface KanbanQuarterSummary {
  /** Quarter key, e.g. "2025-Q2" */
  quarter: string;

  /** ISO 8601 start of quarter (inclusive) */
  quarterStart: string;

  /** ISO 8601 end of quarter (inclusive) */
  quarterEnd: string;

  /** "active" if this is the current calendar quarter; "closed" otherwise */
  state: 'active' | 'closed';

  /** Total issues pulled onto the board during this quarter */
  totalIssues: number;

  /** Issues that transitioned to a done status during this quarter */
  completedIssues: number;

  /** Issues whose board-entry date was strictly after quarter start */
  addedMidQuarter: number;

  /** Sum of story points for all issues in the quarter (null = 0) */
  totalPoints: number;

  /** Sum of story points for completed issues only */
  completedPoints: number;

  /**
   * completedIssues / totalIssues × 100, rounded to 2dp.
   * 0 if totalIssues = 0.
   */
  deliveryRate: number;
}
```

#### 1.5 — Calculation Logic (Backend)

The `getKanbanPlanningQuarters` method in `PlanningService`:

1. Load `BoardConfig` — validate `boardType === 'kanban'`; throw `400` if not.
2. Load all board issues (excluding Epics and Sub-tasks).
3. Load `'status'` changelogs where `fromValue = 'To Do'` for all issue keys — bulk
   query, same as `RoadmapService.getKanbanAccuracy()`.
4. Compute `boardEntryDate` per issue (earliest `'To Do → *'` changelog, fall back to
   `issue.createdAt`).
5. Group issues by `issueToQuarterKey(boardEntryDate)`.
6. For each quarter group, load status changelogs for those issues (bulk, filtered to
   `field = 'status'`) to determine `completedInQuarter`.
7. Compute `addedMidQuarter` as `boardEntryDate > quarterStart`.
8. Assemble `KanbanQuarterSummary[]`, sorted: current quarter first, then descending.

This is a 3–4 query operation per call (config, issues, entry-date changelogs, status
changelogs). No N+1 loops. The pattern mirrors `QuarterDetailService.getDetail()` §4a.

**Important:** The `completedInQuarter` logic must use the same definition as
`QuarterDetailService`: a status changelog transition to `doneStatusNames` within the
quarter's `[quarterStart, quarterEnd]` window. **Not** just `issue.status === done`
(which reflects current status, not when it was done). This consistency matters because
users will click through from this summary table to the Quarter Detail View.

#### 1.6 — Planning Page UI Changes

**File:** `frontend/src/app/planning/page.tsx`

```
Current state:
  - Board selector: PLAT chip disabled
  - Period toggle: Sprint | Quarter (always visible)
  - When PLAT selected: amber warning banner, no data

Proposed state (Kanban mode):
  - Board selector: PLAT chip enabled
  - Period toggle: hidden when isKanban (only Quarter makes sense)
  - When isKanban && no data loaded: loading spinner / empty state
  - When isKanban && data loaded: Kanban quarter table + summary stats + trend charts
```

**Board chip behaviour change:**
```tsx
// Before:
disabled={KANBAN_BOARDS.has(boardId)}
onClick={() => handleSelectBoard(boardId)}  // handleSelectBoard no-ops for Kanban

// After:
disabled={false}  // all boards selectable
onClick={() => handleSelectBoard(boardId)}  // no guard needed
```

**Period toggle:**
```tsx
// Hide entirely when isKanban — Kanban is always quarterly
{!isKanban && (
  <div>
    <label>Period</label>
    <div>
      <button Sprint />
      <button Quarter />
    </div>
  </div>
)}
// When isKanban, periodType is implicitly 'quarter'; no toggle rendered
```

**Summary stat cards (Kanban mode):**
Replace `Avg Scope Change` / `Avg Completion Rate` with:
- **Avg Delivery Rate** — average of `deliveryRate` across all quarters
- **Total Issues Delivered** — sum of `completedIssues` across all quarters

These are semantically equivalent but correctly labelled for flow-based teams.

**Trend charts (Kanban mode):**
Replace the three Scrum charts (Commitment, Completed, Scope Change %) with:
- **Issues Pulled In** (blue) — `totalIssues` per quarter
- **Issues Completed** (green) — `completedIssues` per quarter
- **Delivery Rate %** (amber) — `deliveryRate` per quarter

The `TrendChart` component is reused as-is; only the data and labels change.

**Quarter table (Kanban mode):**

| Column | Sortable | Notes |
|---|---|---|
| Quarter | ✅ | Links to `/quarter/[boardId]/[quarter]` — existing Quarter Detail View |
| State | ✅ | `active` / `closed` pill badge |
| Issues Pulled In | ✅ | `totalIssues` |
| Completed | ✅ | `completedIssues` |
| Mid-Quarter | ✅ | `addedMidQuarter` count |
| Points In | ✅ | `totalPoints` |
| Points Done | ✅ | `completedPoints` |
| Delivery Rate | ✅ | `deliveryRate`% with colour coding: `< 50%` red, `50–80%` amber, `≥ 80%` green |

**Row colouring (Kanban mode):** By delivery rate (inverse of Scrum's scope-change
colouring — low delivery is the concern rather than high scope change):
- `deliveryRate < 50` → `bg-red-50`
- `deliveryRate < 80` → `bg-amber-50`
- else → `''`

**Quarter Detail link:** The `Quarter` column cell links to
`/quarter/[boardId]/[encodeURIComponent(quarter)]?from=planning`. The Quarter Detail
View (`/quarter/[boardId]/[quarter]`) already works for PLAT — no changes needed to that
page or its backend.

**Page header:** When `isKanban`, change the subtitle from:
> "Sprint commitment vs delivery metrics"

to:
> "Quarterly flow metrics — issues pulled in vs. completed"

with a small inline note: *"Sprint-based planning accuracy is not applicable to Kanban
boards."*

#### 1.7 — State Management Changes

`frontend/src/app/planning/page.tsx` currently manages state locally. No changes to
`filter-store.ts` are required. The `isKanban` flag is derived from the `selectedBoard`
constant, as it is today. The `periodType` state is retained but forced to `'quarter'`
whenever `isKanban` is true:

```tsx
// When Kanban board selected, reset to quarter
const handleSelectBoard = useCallback((boardId: string) => {
  setSelectedBoard(boardId)
  setRawData([])
  setError(null)
  if (KANBAN_BOARDS.has(boardId)) {
    setPeriodType('quarter')
  }
}, [])
```

The `rawData` type changes to a union — either `SprintAccuracy[]` (Scrum) or
`KanbanQuarterSummary[]` (Kanban). In practice, they are stored in separate state
variables to avoid type-union complexity:

```tsx
const [sprintData, setSprintData] = useState<SprintAccuracy[]>([])
const [kanbanData, setKanbanData] = useState<KanbanQuarterSummary[]>([])
```

The existing `rawData` reference in the component can be replaced with `isKanban ? kanbanData : sprintData` at the use-sites, or the state can be kept as `rawData` with
a discriminated shape — implementation detail for the developer.

#### 1.8 — API Client Changes

Add to `frontend/src/lib/api.ts`:

```typescript
export interface KanbanQuarterSummary {
  quarter: string
  quarterStart: string
  quarterEnd: string
  state: 'active' | 'closed'
  totalIssues: number
  completedIssues: number
  addedMidQuarter: number
  totalPoints: number
  completedPoints: number
  deliveryRate: number
}

export function getKanbanPlanningQuarters(
  boardId: string,
): Promise<KanbanQuarterSummary[]> {
  return apiFetch(
    `/api/planning/kanban-quarters/${encodeURIComponent(boardId)}`,
  )
}
```

---

### Phase 2: Richer Kanban Flow Metrics (Deferred)

Phase 2 is contingent on adding a `resolutionDate` column to `JiraIssue`. This unlocks:

#### 2.1 — New Sync Field: `JiraIssue.resolutionDate`

Jira's `fields.resolutiondate` is already available in the Jira REST API response for
every issue. The `SyncService.mapJiraIssue()` method currently does not map it.

**Migration required:**

```sql
-- up
ALTER TABLE jira_issues ADD COLUMN resolution_date TIMESTAMPTZ NULL;

-- down
ALTER TABLE jira_issues DROP COLUMN resolution_date;
```

**Entity change:**
```typescript
// backend/src/database/entities/jira-issue.entity.ts
@Column({ type: 'timestamptz', nullable: true })
resolutionDate!: Date | null;
```

**Sync change:**
```typescript
// backend/src/sync/sync.service.ts — mapJiraIssue()
issue.resolutionDate = raw.fields.resolutiondate
  ? new Date(raw.fields.resolutiondate)
  : null;
```

This is a single-column additive migration that does not affect any existing query or
service. It is the only schema change in the entire proposal.

#### 2.2 — Phase 2 Metrics Unlocked by `resolutionDate`

| Metric | Calculation | Column in table |
|---|---|---|
| Median Cycle Time (days) | Median of `(resolutionDate - boardEntryDate)` for completed issues | `Median CT` |
| p85 Cycle Time (days) | 85th percentile of same | `p85 CT` |
| Throughput / week | `completedIssues / weeksInQuarter` | `Throughput/wk` |

**Cycle time vs. board-entry date:** Using `boardEntryDate` (first move off "To Do") as
the start of cycle time is semantically correct for Kanban — it represents when work
began, not when the issue was filed. Resolution date is the end of cycle time.

**Why not use changelog replay for cycle time now?** The `jira_changelogs` table has
the data to reconstruct resolution date (when an issue transitioned to a done status),
but this would replicate what `resolutionDate` gives us directly and for free. Using
`fields.resolutiondate` is cheaper (one column read), more accurate (Jira sets it
atomically), and eliminates edge cases where the same issue transitions to done multiple
times (reopened then re-resolved).

#### 2.3 — Phase 2 UI Additions

The Kanban quarter table gains two new optional columns that render as `—` when
`resolutionDate` data is absent:
- `Median CT` (days)
- `p85 CT` (days)

The trend chart panel gains a fourth chart:
- **Median Cycle Time** (purple) — `medianCycleDays` per quarter

The summary stat cards gain:
- **Median Cycle Time** (replaces one of the existing cards or added as a third row)

These additions do not require frontend changes until the backend endpoint returns the
new fields — the table renders `—` gracefully for missing numeric values.

---

## Data Availability Assessment

### Phase 1 — Fully Available Today

| Data needed | Entity / field | Available? |
|---|---|---|
| Issue board-entry date | Derived: earliest `status` changelog where `fromValue = 'To Do'`; fallback `JiraIssue.createdAt` | ✅ |
| Issue completion in quarter | `JiraChangelog` status transitions to `BoardConfig.doneStatusNames` within quarter window | ✅ |
| Story points | `JiraIssue.points` | ✅ |
| Issue type (exclude Epic/Sub-task) | `JiraIssue.issueType` | ✅ |
| Board type (Kanban vs Scrum) | `BoardConfig.boardType` | ✅ |
| Done status names | `BoardConfig.doneStatusNames` | ✅ |
| Quarter date boundaries | Derived from `YYYY-QN` string | ✅ |
| Mid-quarter additions | `boardEntryDate > quarterStart` | ✅ |
| Quarter Detail drill-through | `GET /api/quarters/PLAT/:quarter/detail` — already works | ✅ |

### Phase 2 — Requires Migration

| Data needed | Entity / field | Available? | Effort |
|---|---|---|---|
| Resolution date | `JiraIssue.resolutionDate` (not yet synced) | ❌ | 1 migration + 1 sync field |
| Cycle time | Derived from `resolutionDate - boardEntryDate` | ❌ (blocked on above) | Calculation only |
| Flow efficiency (% active time) | Status changelog replay over all statuses per issue | ⚠️ (data exists, expensive) | New algorithm in service |
| WIP at quarter start/end | Changelog reconstruction across all status transitions | ⚠️ (data exists, expensive) | New algorithm + index |

---

## Alternatives Considered

### Alternative A — Keep Kanban Boards Blocked (Status Quo)
Continue showing the amber warning for PLAT on the Planning page. The Quarter Detail
View is reachable from the Roadmap page.

**Rejected because:** The Quarter Detail View is already a useful drill-down for PLAT,
but there is no planning-oriented summary view that shows quarter-over-quarter trends for
Kanban boards. Users have to navigate to the Roadmap page and use its quarter-mode to
see delivery trends, which is a roadmap-alignment view, not a planning-accuracy view.
The data to produce meaningful Kanban flow metrics exists today and requires no new
infrastructure.

### Alternative B — Redirect Kanban Board Selection to the Roadmap Page
When PLAT is selected on the Planning page, redirect the user to `/roadmap?boardId=PLAT`.

**Rejected because:** The Roadmap page shows roadmap _alignment_ metrics (coverage,
delivery rate against JPD ideas), not flow/throughput metrics. A user asking "how much
did we deliver this quarter?" is not asking a roadmap alignment question. Routing them
to the Roadmap page conflates two different analytic frames and is confusing. It also
breaks if the user does not have a JPD project configured.

### Alternative C — Show a Single Unified Quarterly View for Both Scrum and Kanban
Compute a unified "quarter summary" for both board types from sprint data (Scrum) or
board-entry bucketing (Kanban) and show one consistent table regardless of board type.
This would mean computing `commitment` for Scrum quarters by summing sprint commitments
and presenting Kanban quarters as having `commitment = issues pulled in`.

**Rejected because:** The columns have different semantic meanings for the two board
types. Showing a `Commitment` column for a Kanban board implies there was a planning
event with a defined scope, which is misleading. Separate column schemas per mode is
more honest and less likely to produce wrong conclusions. The current mode-switching
pattern in the Planning page (sprint columns vs. quarter columns) already demonstrates
that different column schemas per mode are acceptable.

### Alternative D — Phase 2 First (Add resolutionDate Before Phase 1)
Delay the UI until `resolutionDate` is synced and cycle time can be shown.

**Rejected because:** Phase 1 is valuable on its own — throughput and delivery rate are
the most-asked Kanban planning questions, and they are answerable today. A migration
carries operational risk (requires `npm run migration:run`); deferring it until Phase 2
is the right risk management approach for a single-user internal tool.

---

## Impact Assessment

| Area | Phase | Impact | Notes |
|---|---|---|---|
| Database | Phase 1 | **None** | No schema changes. All required data is in existing tables. |
| Database | Phase 2 | **Additive migration** | One new nullable column `resolution_date` on `jira_issues`. Reversible. |
| API contract | Phase 1 | **Additive** | New endpoint `GET /api/planning/kanban-quarters/:boardId`. No existing endpoints changed. |
| API contract | Phase 2 | **Additive** | `KanbanQuarterSummary` gains `medianCycleDays` and `p85CycleDays` fields. |
| Frontend | Phase 1 | **Modified page** | `planning/page.tsx` gains Kanban mode. Board chip enables PLAT. Period toggle hides for Kanban. New table columns, summary cards, and trend charts for Kanban mode. |
| Frontend | Phase 2 | **Minor additions** | Two new columns in Kanban quarter table; one new trend chart; one new summary card. |
| `filter-store.ts` | Phase 1 | **None** | All state is local to `planning/page.tsx`. |
| Tests | Phase 1 | **New unit tests** | `PlanningService.getKanbanPlanningQuarters()`: board-entry bucketing, completedInQuarter window, addedMidQuarter, 400 for Scrum board, empty quarter handling, point summation with null. |
| Tests | Phase 2 | **Updated unit tests** | Add cycle time calculation tests once `resolutionDate` is synced. |
| Jira API | Phase 1 | **No new calls** | All data read from Postgres. No rate-limit impact. |
| Jira API | Phase 2 | **Existing field added to sync** | `fields.resolutiondate` is already returned by the Jira API but not mapped. Adding it to `mapJiraIssue()` costs zero additional API calls. |
| `PlanningModule` | Phase 1 | **Additive** | New method `getKanbanPlanningQuarters()` in `PlanningService`; new route `GET /api/planning/kanban-quarters/:boardId` in `PlanningController`. |
| `SyncService` | Phase 2 | **Minor change** | `mapJiraIssue()` maps `fields.resolutiondate` to `issue.resolutionDate`. |
| `ADR-0005` | Phase 1 | **Partially superseded** | The Kanban board exclusion decision is superseded for the Planning page UI. The principle that _sprint_-based planning accuracy is inapplicable to Kanban boards is retained and reflected in the updated UI labelling. |

---

## Module Boundary and Dependency Rules

```
PlanningModule
  PlanningController  →  PlanningService
  PlanningService     →  JiraSprint, JiraIssue, JiraChangelog, BoardConfig (TypeORM)

QuarterModule (existing, unchanged)
  QuarterController  →  QuarterDetailService
  QuarterDetailService → JiraIssue, JiraChangelog, BoardConfig, RoadmapConfig, JpdIdea

Frontend: planning/page.tsx
  isKanban = false  →  getPlanningAccuracy()   →  GET /api/planning/accuracy
  isKanban = true   →  getKanbanPlanningQuarters()  →  GET /api/planning/kanban-quarters/:boardId
  (both modes)      →  quarter table row click  →  /quarter/[boardId]/[quarter]  (existing)
```

`PlanningService` does **not** import `QuarterDetailService`. The board-entry bucketing
and completion logic is duplicated in `PlanningService` with a TODO comment to extract
to a shared utility (`backend/src/utils/kanban-board-entry.ts`) — the same
"duplicate with TODO" pattern established in Proposal 0004 §7.5.

---

## Open Questions

### OQ-1 — Should `PlanningService.getKanbanPlanningQuarters` delegate to `QuarterDetailService`?

An alternative to duplicating the board-entry bucketing logic is for `PlanningService`
to inject `QuarterDetailService` (or a shared helper service) and call `getDetail()` for
each quarter, then aggregate the summaries. This would eliminate the duplication but
introduce a cross-module service dependency (`PlanningModule` → `QuarterModule`) and
make each call to `getKanbanPlanningQuarters` execute N quarter-detail queries (one per
quarter). Given that a board may have 8–12 quarters of data, this is a significant
performance problem.

**Recommendation:** Duplicate the bucketing logic in `PlanningService` with a shared
utility extraction TODO. Do not create a cross-module service dependency.

**Needs confirmation:** Is the team comfortable with this controlled duplication, or
would they prefer to extract the shared logic to a utility service immediately?

### OQ-2 — How should `addedMidQuarter` be interpreted for Kanban boards?

For Scrum boards, `addedMidQuarter` in the Quarter Detail View means the issue's
board-entry date was after the quarter started. For Kanban boards, since we _define_
the quarter by when issues were pulled in, every issue in a quarter was "pulled in"
during that quarter by construction. `addedMidQuarter` for Kanban thus means the issue
entered the queue _after the first week_ of the quarter (or some other threshold),
distinguishing "early quarter pull" from "late-arriving demand."

There are two options:
- **Option A:** Treat `addedMidQuarter` the same way for Kanban as for Scrum (strictly
  after `quarterStart`). Accept that this means virtually all Kanban issues will show
  `addedMidQuarter = true` (since most are pulled in after Jan 1 / Apr 1 / etc.).
- **Option B:** For Kanban, use a grace period (e.g. first 2 weeks of the quarter) to
  distinguish "in-quarter planned" from "late demand."

**Recommendation:** Use Option A for Phase 1 (simplicity, consistency with Quarter
Detail View). Surface the `addedMidQuarter` count as an informational metric, not a
health signal, and label it "Issues added after quarter start" rather than "Scope creep."
Revisit in Phase 2.

**Needs confirmation from team/product owner.**

### OQ-3 — Should the Kanban quarter table link to Quarter Detail at all times?

The Quarter Detail View for PLAT works and shows per-issue breakdown. However, it is
currently navigated to from the Roadmap page, not the Planning page. ADR-0016 (Proposal
0004) shows the Quarter Detail back-link going to `/roadmap`, not `/planning`. If we
add a navigation path from `/planning` → `/quarter/[boardId]/[quarter]`, the back-link
on the Quarter Detail page needs to handle both origins.

**Options:**
- Add `?from=planning` query parameter (same pattern as the existing `?from=planning`
  on the sprint detail link in the Scrum planning page).
- Show a generic back-link "← Back" using `router.back()`.

**Recommendation:** Use `?from=planning` consistent with the Scrum sprint detail
pattern already in `planning/page.tsx` (line 332 shows `?from=planning` on sprint links).
The Quarter Detail page already accepts `?from=planning` in the existing implementation
(confirmed by inspecting `planning/page.tsx` lines 398–401). No change to Quarter Detail
page needed.

**This question is informational — no blocking decision required.**

### OQ-4 — Phase 2 migration timing

The `resolutionDate` migration is simple and low-risk, but it requires a sync run to
backfill data for historical issues. In a single-user internal tool, the operator can
trigger a manual sync. However, cycle time metrics will show `null` for any issue
resolved before the first sync after the migration is applied.

**Needs confirmation:** Is the team comfortable with partial cycle time data for the
first quarter after Phase 2 migration, or is a backfill strategy needed?

---

## Acceptance Criteria

### Phase 1

- [ ] The PLAT board chip on the Planning page is **enabled** (not greyed out).
- [ ] Selecting PLAT puts the page into Kanban mode.
- [ ] In Kanban mode, the Sprint/Quarter period toggle is **hidden**.
- [ ] In Kanban mode, the amber "Planning accuracy is not available for Kanban boards"
      banner is **not shown**; instead the page subtitle reads "Quarterly flow metrics —
      issues pulled in vs. completed."
- [ ] In Kanban mode, the page fetches from `GET /api/planning/kanban-quarters/PLAT`.
- [ ] `GET /api/planning/kanban-quarters/ACC` returns `400 Bad Request` (Scrum board).
- [ ] `GET /api/planning/kanban-quarters/PLAT` returns `KanbanQuarterSummary[]` sorted
      with current quarter first, then descending.
- [ ] Each `KanbanQuarterSummary` includes: `quarter`, `quarterStart`, `quarterEnd`,
      `state`, `totalIssues`, `completedIssues`, `addedMidQuarter`, `totalPoints`,
      `completedPoints`, `deliveryRate`.
- [ ] `deliveryRate = Math.round((completedIssues / totalIssues) * 10000) / 100`, or
      `0` when `totalIssues = 0`.
- [ ] `completedInQuarter` uses the same definition as `QuarterDetailService`: a status
      changelog transition to a `doneStatusName` within `[quarterStart, quarterEnd]`.
- [ ] `addedMidQuarter` counts issues where `boardEntryDate > quarterStart`.
- [ ] Board-entry date uses the `'To Do → *'` changelog logic from
      `RoadmapService.getKanbanAccuracy()` with `issue.createdAt` fallback.
- [ ] Kanban mode summary stats show "Avg Delivery Rate" and "Total Issues Delivered"
      (not "Avg Scope Change" and "Avg Completion Rate").
- [ ] Kanban mode trend charts show "Issues Pulled In", "Issues Completed", and
      "Delivery Rate %".
- [ ] The Kanban quarter table columns match the spec in §1.6.
- [ ] Row colouring: `deliveryRate < 50` → `bg-red-50`; `< 80` → `bg-amber-50`.
- [ ] The `Quarter` column cell is a link to `/quarter/[boardId]/[quarter]?from=planning`.
- [ ] Selecting a Scrum board after PLAT switches back to Scrum mode with Sprint/Quarter
      toggle visible.
- [ ] No TypeScript `any` types introduced.
- [ ] No new npm packages added to `frontend/package.json`.
- [ ] All new backend files use `.js` ESM import suffixes.
- [ ] Frontend files use no semicolons.
- [ ] `PlanningService` makes no more than 4 database round-trips per
      `getKanbanPlanningQuarters()` call (no N+1 queries).
- [ ] `PlanningModule` does not import `QuarterModule`.

### Phase 2 (to be verified after migration)

- [ ] `jira_issues.resolution_date` column exists and is nullable.
- [ ] Migration is reversible (up + down defined).
- [ ] `SyncService.mapJiraIssue()` maps `fields.resolutiondate` to `issue.resolutionDate`.
- [ ] `KanbanQuarterSummary` includes `medianCycleDays: number | null` and
      `p85CycleDays: number | null`.
- [ ] Cycle time is calculated as `resolutionDate - boardEntryDate` in days, median and
      p85, for completed issues only.
- [ ] Issues with `resolutionDate = null` are excluded from cycle time calculation.
- [ ] Kanban quarter table renders `Median CT` and `p85 CT` columns; shows `—` when
      `null`.
- [ ] Kanban mode trend charts include a fourth "Median Cycle Time" chart.
