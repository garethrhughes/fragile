# 0002 — Sprint Detail View

**Date:** 2026-04-10
**Status:** Draft
**Author:** Architect Agent
**Related ADRs:** None yet — ADRs will be created when this proposal is accepted.

---

## Problem Statement

The existing Planning, DORA, and Roadmap dashboards expose _aggregate_ sprint-level
metrics: totals, rates, and trend lines. A team that spots an anomaly (e.g. high scope
change, low roadmap coverage, elevated CFR) has no path from that aggregate number to
the individual tickets responsible. Every annotation signal that the system already
computes — scope creep, roadmap linkage, incident classification, failure classification,
lead time, completion — lives in separate endpoints with no per-issue breakdown.

The result is that post-sprint retrospectives require the team to leave the dashboard and
manually cross-reference Jira, defeating the purpose of the tool. This proposal adds a
**Sprint Detail View**: a single read-only screen reachable by clicking a sprint row from
any existing table, showing every ticket in that sprint with all metric annotations
computed and displayed inline.

---

## Proposed Solution

### Overview

```
[Planning table row click]  ─────────────────────────────────┐
[Roadmap table row click]   ─────────────────────────────────┤
[DORA sprint selector]      ─────────────────────────────────┘
                                         │
                        /sprint/[boardId]/[sprintId]  (Next.js page)
                                         │
                        GET /api/sprints/:boardId/:sprintId/detail
                                         │
                                SprintDetailService
                                         │
                ┌────────────────────────┴──────────────────────────┐
                │                                                    │
        jira_sprints (1 row)                             BoardConfig (1 row)
        jira_issues  (N rows, sprintId match + changelog replay)
        jira_changelogs (sprint-field + status-field, bulk)
        jpd_ideas   (all, for coveredEpicKeys set)
```

A new `SprintModule` owns a `SprintDetailService` and a `SprintController`. It depends
on the same entities as the existing planning and roadmap modules but performs a single
coordinated query sequence per request, returning a fully annotated per-issue response.
The frontend page is a new Next.js dynamic route at
`frontend/src/app/sprint/[boardId]/[sprintId]/page.tsx`.

No new npm packages are required. No new database migrations are required.

---

### 1. Navigation — Entry Points

There are three natural entry points, one per existing table view. All three navigate
to the same URL shape: `/sprint/[boardId]/[sprintId]`.

#### 1a. Planning page (`/planning`)

The `sprintName` column in the sprint-mode `DataTable` gains a `render` override that
wraps the name in a `<Link>` (Next.js `Link` from `next/link`):

```tsx
// In planning/page.tsx — modify the sprintColumns definition
{
  key: 'sprintName',
  label: 'Sprint',
  sortable: true,
  render: (value, row) => (
    <Link
      href={`/sprint/${encodeURIComponent(selectedBoard)}/${encodeURIComponent(row.sprintId)}`}
      className="font-medium text-blue-600 hover:underline"
    >
      {String(value)}
    </Link>
  ),
},
```

The `selectedBoard` local state is already available in scope. `row.sprintId` is
available because `SprintAccuracy` already carries it.

#### 1b. Roadmap page (`/roadmap`)

The same pattern in the sprint-mode `DataTable` in `roadmap/page.tsx`:

```tsx
{
  key: 'sprintName',
  label: 'Sprint',
  sortable: true,
  render: (value, row) => (
    <Link
      href={`/sprint/${encodeURIComponent(selectedBoard)}/${encodeURIComponent(row.sprintId)}`}
      className="font-medium text-blue-600 hover:underline"
    >
      {String(value)}
    </Link>
  ),
},
```

#### 1c. DORA page (`/dora`)

The DORA page does not currently surface a per-sprint table, but it loads sprint names
via `getSprints()`. A future enhancement could add a "View sprint →" link next to the
period selector. For this proposal, DORA is treated as an **out-of-scope entry point**;
it is noted here so the URL scheme is compatible with it.

#### 1d. URL Structure

```
/sprint/[boardId]/[sprintId]
```

Examples:
- `/sprint/ACC/12345`
- `/sprint/BPT/67890`

`boardId` and `sprintId` are both path parameters. `boardId` is needed to load the
`BoardConfig` and to scope issue queries — `sprintId` alone is not sufficient because
sprint IDs from the Jira Agile API are globally unique integers but the board context
determines which `BoardConfig` rules apply.

The page does **not** appear in the sidebar navigation (it is a drill-through, not a
top-level view). The sidebar `NAV_ITEMS` array in `sidebar.tsx` is left unchanged.

#### 1e. Back Navigation

The page renders a breadcrumb or back-link. Because the entry point varies, the page
derives context from query parameters:

```
/sprint/ACC/12345?from=planning
/sprint/ACC/12345?from=roadmap
```

`from` is optional. If present, the back-link label reads "← Planning" or "← Roadmap"
respectively and uses `router.back()` (Next.js `useRouter`). If absent, the link reads
"← Dashboard" and navigates to `/planning` as a sensible default.

---

### 2. Data Model — What Is Already Available

**No new database migrations are required.** Every annotation can be derived from
existing tables using already-synced data.

The full data model required by the service is:

| Source entity | Fields used | Already present? |
|---|---|---|
| `JiraSprint` | `id`, `name`, `state`, `startDate`, `endDate`, `boardId` | ✅ |
| `JiraIssue` | `key`, `summary`, `status`, `issueType`, `epicKey`, `labels`, `createdAt`, `sprintId`, `boardId` | ✅ |
| `JiraChangelog` | `issueKey`, `field`, `fromValue`, `toValue`, `changedAt` | ✅ |
| `JpdIdea` | `deliveryIssueKeys` (array of epic keys) | ✅ |
| `BoardConfig` | `doneStatusNames`, `failureIssueTypes`, `failureLabels`, `failureLinkTypes`, `incidentIssueTypes`, `incidentLabels` | ✅ |

**Critical observation on `JiraIssue.sprintId`:** The `sprintId` column stores the
_last-synced_ sprint for an issue. Because Jira upserts overwrite this on every sync,
an issue that moved between sprints will only show the most-recent value. The sprint
detail view must therefore reconstruct sprint membership from `JiraChangelog`
(field = `'Sprint'`) — exactly the same approach used by `PlanningService`. This is
a known limitation that `PlanningService` already handles correctly.

**Critical observation on link-based CFR (`failureLinkTypes`):** The `JiraIssue` entity
does not store `issuelinks`. Link-based failure detection (an issue linked *to* another
via a `failureLinkType`) cannot be evaluated from the database alone. Two options exist:

1. **Skip link-based CFR annotation** at the per-issue level — only type and label rules
   are evaluated. The aggregate CFR metric (which also skips link detection in the
   current `CfrService`) is unaffected.
2. **Fetch issue links live from Jira** — violates the rule that metric services never
   call Jira directly, and would impose per-sprint latency.

**Decision (see Open Questions §7.3):** Link-based CFR is excluded from the per-issue
annotation. The `isFailure` column reflects `failureIssueTypes` OR `failureLabels` only,
consistent with the existing `CfrService` implementation which also does not evaluate
`failureLinkTypes` at query time.

---

### 3. Backend API

#### 3a. Module Location: New `SprintModule`

The feature does **not** belong in the `roadmap` module (roadmap concerns JPD
alignment, not generic sprint breakdown), nor in `planning` (planning concerns
commitment vs delivery totals, not per-issue breakdown), nor in `metrics` (metrics
concern DORA aggregates across time periods). The correct home is a new, narrow
`sprint` module owning a single service and controller.

This maintains the existing dependency rule: calculation logic lives in services,
controllers remain thin.

```
backend/src/sprint/
  sprint.module.ts
  sprint.controller.ts
  sprint-detail.service.ts
  dto/
    sprint-detail-query.dto.ts
```

#### 3b. Endpoint

```
GET /api/sprints/:boardId/:sprintId/detail
```

Protected by `ApiKeyAuthGuard` (same guard used across all other controllers).

**Request parameters:**

| Parameter | In | Type | Required | Description |
|---|---|---|---|---|
| `boardId` | path | `string` | ✅ | Board identifier (e.g. `ACC`) |
| `sprintId` | path | `string` | ✅ | Sprint numeric ID as string |

No query parameters. The response is fully self-contained — all annotation logic is
server-side.

**Error responses:**

| Status | Condition |
|---|---|
| `400 Bad Request` | `boardId` refers to a Kanban board (`boardType === 'kanban'`) |
| `404 Not Found` | No `JiraSprint` row matches `{ id: sprintId, boardId }` |

#### 3c. Response DTO

```typescript
// backend/src/sprint/dto/sprint-detail-query.dto.ts
// (used only for path param validation — NestJS uses @Param() not @Query() here)

// backend/src/sprint/sprint-detail.service.ts — exported interfaces

export interface SprintDetailIssue {
  /** Jira issue key, e.g. "ACC-123" */
  key: string;

  /** Issue summary / title */
  summary: string;

  /** Current status at time of last sync */
  currentStatus: string;

  /** Jira issue type, e.g. "Story", "Bug", "Task" */
  issueType: string;

  /**
   * True if the issue was added to the sprint AFTER sprint start
   * (using the 5-minute grace period defined in PlanningService).
   * False if the issue was present at sprint start or created in the sprint
   * within the grace window.
   */
  addedMidSprint: boolean;

  /**
   * True if the issue's epicKey is a member of the coveredEpicKeys set
   * (i.e. issue.epicKey ∈ any JpdIdea.deliveryIssueKeys).
   * False if epicKey is null or not covered.
   */
  roadmapLinked: boolean;

  /**
   * True if the issue matches incidentIssueTypes OR incidentLabels
   * from BoardConfig. This is the MTTR signal.
   */
  isIncident: boolean;

  /**
   * True if the issue matches failureIssueTypes OR failureLabels
   * from BoardConfig. This is the CFR signal.
   * Note: link-based failure detection (failureLinkTypes) is excluded
   * at the per-issue level — see proposal §2 and §7.3.
   */
  isFailure: boolean;

  /**
   * True if the issue transitioned to a doneStatusName between
   * sprint.startDate and sprint.endDate (inclusive).
   * For active sprints, sprint.endDate is treated as the current time.
   */
  completedInSprint: boolean;

  /**
   * Lead time in days, or null if it cannot be computed.
   * = (firstDoneTransitionDate - firstInProgressTransitionDate) in days.
   * Falls back to (firstDoneTransitionDate - issue.createdAt) if no
   * "In Progress" transition exists.
   * Null if no done transition is found in the changelog at all.
   */
  leadTimeDays: number | null;

  /**
   * ISO 8601 timestamp of the issue's first done-status transition,
   * or null if no such transition is found. Used to display "resolved at"
   * in the UI without requiring a second calculation pass.
   */
  resolvedAt: string | null;

  /**
   * Deep link to the issue in Jira Cloud.
   * Constructed as: `${JIRA_BASE_URL}/browse/${key}`
   * Populated from the JIRA_BASE_URL environment variable.
   */
  jiraUrl: string;
}

export interface SprintDetailSummary {
  /** Count of issues present at sprint start (committed scope) */
  committedCount: number;

  /** Count of issues added after sprint start */
  addedMidSprintCount: number;

  /** Count of issues removed during the sprint */
  removedCount: number;

  /** Count of issues completed within the sprint window */
  completedInSprintCount: number;

  /** Count of issues linked to a JPD roadmap item */
  roadmapLinkedCount: number;

  /** Count of issues classified as incidents (MTTR signal) */
  incidentCount: number;

  /** Count of issues classified as failures (CFR signal) */
  failureCount: number;

  /** Median lead time in days across completed issues, or null if no completed issues */
  medianLeadTimeDays: number | null;
}

export interface SprintDetailResponse {
  sprintId: string;
  sprintName: string;
  state: string;             // 'active' | 'closed' | 'future'
  startDate: string | null;  // ISO 8601
  endDate: string | null;    // ISO 8601

  /** The BoardConfig rules applied to derive annotations */
  boardConfig: {
    doneStatusNames: string[];
    failureIssueTypes: string[];
    failureLabels: string[];
    incidentIssueTypes: string[];
    incidentLabels: string[];
  };

  /** Aggregate summary bar counts */
  summary: SprintDetailSummary;

  /**
   * All issues that were part of this sprint (committed + added - removed).
   * Epics and Sub-tasks are excluded.
   * Sorted: incomplete issues first (alphabetical by key), then completed.
   */
  issues: SprintDetailIssue[];
}
```

#### 3d. Controller (thin)

```typescript
// backend/src/sprint/sprint.controller.ts

@ApiTags('sprints')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard)
@Controller('api/sprints')
export class SprintController {
  constructor(private readonly sprintDetailService: SprintDetailService) {}

  @ApiOperation({ summary: 'Get annotated ticket-level breakdown for a sprint' })
  @Get(':boardId/:sprintId/detail')
  async getDetail(
    @Param('boardId') boardId: string,
    @Param('sprintId') sprintId: string,
  ): Promise<SprintDetailResponse> {
    return this.sprintDetailService.getDetail(boardId, sprintId);
  }
}
```

---

### 4. Backend Service: `SprintDetailService`

#### 4a. Query Strategy — Single Coordinated Pass

The service must avoid N+1 queries. The pattern used by `PlanningService` and
`RoadmapService` is followed:

1. Load sprint (1 query)
2. Load all board issues (1 query, `boardId` scoped — required for changelog replay)
3. Bulk-load Sprint-field changelogs for all board issue keys (1 query)
4. Identify the final sprint membership set (in-memory replay)
5. Bulk-load status-field changelogs for sprint member issue keys (1 query)
6. Load `BoardConfig` (1 query, or from cache — already in pattern)
7. Load `JpdIdea` rows (1 query) → build `coveredEpicKeys` set (in-memory)

Total: 6 database round-trips regardless of sprint size. No unbounded queries.

#### 4b. Sprint Membership Reconstruction

This is the most complex part of the service. It reuses the **exact same algorithm**
as `PlanningService.calculateSprintAccuracy()`, including:

- The 5-minute grace period (`SPRINT_GRACE_PERIOD_MS = 5 * 60 * 1000`)
- The `sprintValueContains()` comma-split exact-match helper
- The `wasInSprintAtDate()` changelog replay logic

The service additionally tracks **per-issue** `addedMidSprint` and `removed` flags so
they can be included in the response (planning service only exposes aggregate counts).

**Membership reconstruction algorithm** (produces the `finalIssueSet` and per-issue flags):

```
For each issue in boardIssues (filtered: issueType ≠ 'Epic' AND issueType ≠ 'Sub-task'):

  sprintLogs = Sprint-field changelogs for this issue that reference sprint.name
  createdAt  = issue.createdAt

  // Was the issue in the sprint at start? (grace period applied)
  wasAtStart = wasInSprintAtDate(sprintLogs, sprint.name, sprint.startDate)

  // Was it created directly into the sprint during the grace window?
  createdMidSprint = (sprintLogs.length === 0)
                     && (createdAt > sprint.startDate + GRACE_PERIOD)

  inSprintAtEnd     = wasAtStart || createdMidSprint
  addedMidSprint    = createdMidSprint
  removedFromSprint = false

  for cl in sprintLogs where cl.changedAt ∈ (sprint.startDate, sprint.endDate]:
    if sprintValueContains(cl.toValue, sprint.name):
      if !inSprintAtEnd && !wasAtStart:
        addedMidSprint = true
      inSprintAtEnd = true
    if sprintValueContains(cl.fromValue, sprint.name) && !sprintValueContains(cl.toValue, sprint.name):
      inSprintAtEnd = false
      if wasAtStart || addedMidSprint:
        removedFromSprint = true

  if wasAtStart || addedMidSprint:
    include issue in finalIssueSet
    record: addedMidSprint flag, removedFromSprint flag

// Issues with removedFromSprint = true are EXCLUDED from finalIssueSet
// (they are counted in the summary but not shown in the issues array)
```

#### 4c. Annotation Derivation Rules

For each issue in `finalIssueSet` (epics and sub-tasks already excluded):

**`addedMidSprint`**
```
addedMidSprint = (the issue's first Sprint-field changelog pointing TO this sprint)
                 .changedAt > (sprint.startDate + 5 minutes)
              OR (issue.createdAt > sprint.startDate + 5 minutes
                  AND no Sprint-field changelog exists for this sprint)
```

**`roadmapLinked`**
```
roadmapLinked = issue.epicKey !== null
             && coveredEpicKeys.has(issue.epicKey)

where coveredEpicKeys = new Set(
  allJpdIdeas.flatMap(idea => idea.deliveryIssueKeys ?? []).filter(Boolean)
)
```
This is identical to the rule used by `RoadmapService.calculateSprintAccuracy()`.

**`isIncident`**
```
isIncident = boardConfig.incidentIssueTypes.includes(issue.issueType)
          || (boardConfig.incidentLabels.length > 0
              && issue.labels.some(l => boardConfig.incidentLabels.includes(l)))
```
Mirrors `MttrService.calculate()` line for line.

**`isFailure`**
```
isFailure = boardConfig.failureIssueTypes.includes(issue.issueType)
         || issue.labels.some(l => boardConfig.failureLabels.includes(l))
```
Mirrors `CfrService.calculate()` line for line.
Link-based detection (`failureLinkTypes`) is **not evaluated** — see §2 and §7.3.

**`completedInSprint`**

Uses the status-field changelogs bulk-loaded in step 5 of §4a.

```
sprintWindow = [sprint.startDate, sprint.endDate ?? new Date()]

completedInSprint =
  // Current status is already done (and issue is still in sprint)
  boardConfig.doneStatusNames.includes(issue.status)
  ||
  // Or: a status changelog transitioned TO a done status within the sprint window
  statusChangelogs
    .filter(cl => cl.issueKey === issue.key)
    .some(cl => boardConfig.doneStatusNames.includes(cl.toValue ?? '')
             && cl.changedAt >= sprint.startDate
             && cl.changedAt <= (sprint.endDate ?? new Date()))
```

This mirrors `PlanningService.calculateSprintAccuracy()` completed-set logic exactly.

**`leadTimeDays` and `resolvedAt`**

Uses the same status-field changelogs already loaded for `completedInSprint`.

```
issueLogs = statusChangelogs for this issue, ordered by changedAt ASC

inProgressTransition = first log where toValue === 'In Progress'
startTime = inProgressTransition?.changedAt ?? issue.createdAt

doneTransition = first log where doneStatusNames.includes(toValue)
resolvedAt     = doneTransition?.changedAt ?? null

leadTimeDays =
  doneTransition !== null
  ? (doneTransition.changedAt.getTime() - startTime.getTime()) / 86_400_000
  : null
```

For `leadTimeDays`, values are rounded to 2 decimal places. Negative values (data
anomalies where createdAt > resolvedAt) are clamped to `null`.

This is consistent with `LeadTimeService.calculate()` for Scrum boards (falls back
to `issue.createdAt` when no In Progress transition exists).

**`jiraUrl`**

```
jiraUrl = `${process.env.JIRA_BASE_URL}/browse/${issue.key}`
```

`JIRA_BASE_URL` is already expected to be present in the environment (used by
`JiraClientService`). The service reads it via NestJS `ConfigService`.

#### 4d. Summary Computation

After building `issues[]`, compute `summary` in a single pass:

```typescript
const summary: SprintDetailSummary = {
  committedCount:       issues.filter(i => !i.addedMidSprint).length,
  addedMidSprintCount:  issues.filter(i => i.addedMidSprint).length,
  removedCount:         removedIssues.length,   // tracked separately during membership replay
  completedInSprintCount: issues.filter(i => i.completedInSprint).length,
  roadmapLinkedCount:   issues.filter(i => i.roadmapLinked).length,
  incidentCount:        issues.filter(i => i.isIncident).length,
  failureCount:         issues.filter(i => i.isFailure).length,
  medianLeadTimeDays:   median(issues.filter(i => i.leadTimeDays !== null).map(i => i.leadTimeDays!)) ?? null,
};
```

`median()` is a local utility (same percentile function already duplicated in
`MttrService` and `LeadTimeService` — see §7.5 for deduplication note).

#### 4e. Module Definition

```typescript
// backend/src/sprint/sprint.module.ts

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JiraSprint,
      JiraIssue,
      JiraChangelog,
      BoardConfig,
      JpdIdea,
    ]),
  ],
  controllers: [SprintController],
  providers: [SprintDetailService],
})
export class SprintModule {}
```

`SprintModule` is added to the `imports` array of `AppModule`. No existing modules are
modified except `AppModule`.

---

### 5. Frontend Component Structure

#### 5a. Page File

```
frontend/src/app/sprint/[boardId]/[sprintId]/page.tsx
```

This is a Next.js 16 dynamic route. It is a `'use client'` component (no RSC data
fetching needed — consistent with all other pages in this project).

#### 5b. API Client Additions (`frontend/src/lib/api.ts`)

```typescript
// New types added to api.ts

export interface SprintDetailIssue {
  key: string;
  summary: string;
  currentStatus: string;
  issueType: string;
  addedMidSprint: boolean;
  roadmapLinked: boolean;
  isIncident: boolean;
  isFailure: boolean;
  completedInSprint: boolean;
  leadTimeDays: number | null;
  resolvedAt: string | null;
  jiraUrl: string;
}

export interface SprintDetailSummary {
  committedCount: number;
  addedMidSprintCount: number;
  removedCount: number;
  completedInSprintCount: number;
  roadmapLinkedCount: number;
  incidentCount: number;
  failureCount: number;
  medianLeadTimeDays: number | null;
}

export interface SprintDetailResponse {
  sprintId: string;
  sprintName: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  boardConfig: {
    doneStatusNames: string[];
    failureIssueTypes: string[];
    failureLabels: string[];
    incidentIssueTypes: string[];
    incidentLabels: string[];
  };
  summary: SprintDetailSummary;
  issues: SprintDetailIssue[];
}

// New typed API function
export function getSprintDetail(
  boardId: string,
  sprintId: string,
): Promise<SprintDetailResponse> {
  return apiFetch(
    `/api/sprints/${encodeURIComponent(boardId)}/${encodeURIComponent(sprintId)}/detail`,
  );
}
```

#### 5c. Page Layout

The page is divided into three vertical sections:

```
┌─────────────────────────────────────────────────────────────┐
│ ← Planning   [Sprint Name]    ACC · active   Jan 5 – Jan 19 │  ← Header / breadcrumb
├─────────────────────────────────────────────────────────────┤
│ Committed: 12  │ Added: 3  │ Removed: 1  │ Completed: 10   │  ← Summary bar
│ Roadmap-linked: 8  │ Incidents: 1  │ Failures: 2           │
│ Median Lead Time: 4.3 days                                  │
├─────────────────────────────────────────────────────────────┤
│ [Ticket table — see §5d]                                    │  ← Issues table
└─────────────────────────────────────────────────────────────┘
```

The header uses the same `text-2xl font-bold` style as existing pages. The summary bar
uses a flex-wrap row of small `<div>` stat chips consistent with the metric cards in
`dora/page.tsx`. The issues table reuses `DataTable<SprintDetailIssue>`.

#### 5d. Issues Table Columns

The `DataTable` component accepts a `columns: Column<T>[]` prop with optional
`render` functions. All annotation columns are rendered as icon badges to keep the
table scannable at a glance.

| Column key | Label | Sortable | Render |
|---|---|---|---|
| `key` | Issue | ✅ | `<a href={row.jiraUrl} target="_blank">ACC-123 ↗</a>` |
| `summary` | Summary | ✅ | Plain text, truncated to 60 chars with `title` tooltip |
| `issueType` | Type | ✅ | Plain text |
| `currentStatus` | Status | ✅ | Pill badge (same style as existing state badges) |
| `addedMidSprint` | Scope creep | ✅ | `⚠ Mid-sprint` badge (amber) if true, `—` if false |
| `roadmapLinked` | Roadmap | ✅ | `✓` (green) if true, `—` if false |
| `isIncident` | Incident | ✅ | `🔴 Incident` badge (red-50 bg) if true, `—` if false |
| `isFailure` | Failure | ✅ | `🟠 Failure` badge (orange-50 bg) if true, `—` if false |
| `completedInSprint` | Done in sprint | ✅ | `✓` (green) if true, `—` if false |
| `leadTimeDays` | Lead time | ✅ | `4.3d` or `—` if null |

The `rowClassName` callback applies:
- `bg-red-50` if `isIncident || isFailure`
- `bg-amber-50` if `addedMidSprint && !isIncident && !isFailure`
- `bg-green-50/30` if `completedInSprint && !isIncident && !isFailure && !addedMidSprint`
- `''` otherwise

Priority order: incident/failure > scope creep > completed.

#### 5e. Loading and Error States

- **Loading:** Full-width centered `<Loader2 className="h-8 w-8 animate-spin" />` (same
  as all other pages).
- **Error:** Red error banner (same pattern as other pages).
- **404 / Kanban:** Show `<EmptyState>` with message derived from error type.

#### 5f. No New Dependencies

All UI elements are achievable with:
- Existing `DataTable` component (reused as-is)
- Existing `EmptyState` component
- `lucide-react` (already installed) for `Loader2`, `AlertCircle`, `ChevronLeft`,
  `ExternalLink` icons
- Tailwind CSS classes already in use across the project

No new npm packages are added.

---

### 6. Mid-Sprint Scope Creep Detection (Detailed)

This section provides the precise derivation from raw `JiraChangelog` data.

#### 6a. Changelog Structure for Sprint Membership

When Jira moves an issue into or out of a sprint, it records a changelog entry:

```
field:     'Sprint'
fromValue: 'ACC Sprint 22'          (or null if issue had no sprint before)
toValue:   'ACC Sprint 22, ACC Sprint 23'  (comma-separated when multi-sprint)
changedAt: <timestamp>
```

The `toValue` is a comma-separated list of sprint names currently assigned to the
issue. The `JiraChangelog.toValue` and `fromValue` columns store this raw string.

#### 6b. `sprintValueContains()` — Critical Helper

Sprint names must be matched exactly within the comma-separated string to prevent
"Sprint 1" matching "Sprint 10":

```typescript
function sprintValueContains(value: string | null, sprintName: string): boolean {
  if (!value) return false;
  return value.split(',').some(s => s.trim() === sprintName);
}
```

This function is already implemented in `PlanningService` and must be duplicated in
`SprintDetailService` (or extracted — see §7.5).

#### 6c. `wasInSprintAtDate()` — Grace Period Logic

```typescript
const SPRINT_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

function wasInSprintAtDate(
  sprintChangelogs: JiraChangelog[],  // Sprint-field logs for this issue, ASC order
  sprintName: string,
  date: Date,
): boolean {
  const effectiveDate = new Date(date.getTime() + SPRINT_GRACE_PERIOD_MS);
  let inSprint = false;

  for (const cl of sprintChangelogs) {
    if (cl.changedAt > effectiveDate) break;
    if (sprintValueContains(cl.toValue, sprintName)) inSprint = true;
    if (sprintValueContains(cl.fromValue, sprintName) &&
        !sprintValueContains(cl.toValue, sprintName)) inSprint = false;
  }

  // No Sprint changelog at all = issue was created directly in the sprint
  if (sprintChangelogs.length === 0) return true;
  return inSprint;
}
```

The 5-minute grace period absorbs Jira's bulk-add delay: when a sprint is started,
Jira records `startDate` at the moment of creation, but initial backlog issues are
added ~20–60 seconds later. Without the grace period, every committed issue would be
incorrectly classified as "added mid-sprint."

#### 6d. Determining `addedMidSprint`

An issue is `addedMidSprint = true` if AND ONLY IF:

**Case 1: Has Sprint-field changelog entries referencing this sprint**
- `wasInSprintAtDate(sprintLogs, sprintName, sprint.startDate)` returns `false`
- AND at least one changelog entry with `toValue` containing `sprintName`
  exists with `changedAt > sprint.startDate + GRACE_PERIOD`

**Case 2: No Sprint-field changelog entries (created directly into sprint)**
- `issue.createdAt > sprint.startDate + GRACE_PERIOD`

An issue where `issue.createdAt ≤ sprint.startDate + GRACE_PERIOD` AND `sprintLogs.length === 0`
is treated as committed at start (it was created before or at sprint creation time,
likely because the sprint was created from the backlog with the issue already assigned).

---

### 7. Open Questions

#### 7.1 — Should removed issues appear in the issues table?

Currently proposed: issues removed from the sprint are counted in `summary.removedCount`
but excluded from the `issues[]` array. This keeps the table focused on "what the team
actually worked on." An alternative would be to include them with a `removedFromSprint`
flag and a `bg-gray-50 text-muted` row style. This could be resolved during
implementation and surfaced as a filter toggle ("Show removed issues").

**Recommendation:** Exclude from the issues array by default; add a show/hide toggle in a
follow-on iteration.

#### 7.2 — Jira deep-link URL

The `jiraUrl` field is constructed from `JIRA_BASE_URL`. If `JIRA_BASE_URL` is not
configured, the service should omit the field or return an empty string — the frontend
should render the issue key as plain text instead of a link when `jiraUrl` is empty.

**Recommendation:** Validate `JIRA_BASE_URL` presence in `SprintDetailService`
constructor; log a warning if absent; return `''` for all `jiraUrl` fields.

#### 7.3 — Link-based CFR annotation (`failureLinkTypes`)

`CfrService.calculate()` references `failureLinkTypes` in its config loading but does
**not actually evaluate it** — reading the code, the current failure count is based
solely on `failureIssueTypes` and `failureLabels`. This is consistent with the proposed
per-issue annotation which also omits link evaluation.

Should `failureLinkTypes` ever be evaluated requires storing `issuelinks` in a new
table — a non-trivial schema change. This proposal explicitly excludes it and documents
the gap. A future proposal could add a `jira_issue_links` table.

#### 7.4 — Pagination for large sprints

The `issues[]` array is returned in a single response. Sprints in this project (ACC,
BPT, SPS, OCS, DATA) typically contain 10–40 issues. The response is not paginated.

If a sprint exceeds 200 issues, the `DataTable` component renders all rows in the DOM,
which may cause jank on lower-powered machines. A limit of 500 issues per sprint is
implicit (if the board has 500+ issues matching a sprint, the query still completes,
but the frontend should add a warning banner). Pagination is explicitly deferred.

#### 7.5 — `percentile()` / `median()` utility duplication

The `percentile()` function is currently duplicated in `MttrService`, `LeadTimeService`,
and will be needed again in `SprintDetailService`. This is a candidate for extraction
into a shared utility module at `backend/src/utils/statistics.ts`. Extraction is
recommended but is a separate refactoring concern and is not a prerequisite for this
feature.

**Recommendation:** Duplicate for now with a `// TODO: extract to shared utility`
comment; create a follow-on task.

#### 7.6 — Should the view support re-syncing?

The view is read-only. A sync button (calling `POST /api/sync`) could be placed in the
header, but this is equivalent to the global sync in the layout and is not specific to
the sprint view. The existing sync mechanism in `sync-store.ts` handles this globally.

**Recommendation:** No per-sprint sync button. The global sync in the header is
sufficient.

---

### 8. Risks and Constraints

#### 8.1 — Query Performance

The most expensive query is the bulk load of Sprint-field changelogs across all board
issues. For a board with 2,000 synced issues and 50,000 changelog rows, this query
selects by `issueKey IN (...)` with up to 2,000 keys.

Mitigation:
- The `jira_changelogs` table should have an index on `(issueKey, field)`. If this
  index does not exist, it must be created. **Check the initial migration
  `1775795358704-InitialSchema.ts`** to confirm — if missing, add it as an additive
  migration as part of this feature's implementation.
- The Sprint-field changelog query is scoped to `field = 'Sprint'`, reducing the result
  set significantly.
- The status-field changelog query is scoped to the final sprint membership set only
  (not all board issues), further reducing load.

#### 8.2 — `sprintId` Column Staleness

`JiraIssue.sprintId` stores only the most-recently synced sprint. Issues that were in
the requested sprint but have since moved to a later sprint will have a different
`sprintId` at query time. The service cannot rely on `WHERE sprintId = :id` alone — it
must load all board issues and replay changelogs, as `PlanningService` does. This is
correctly handled in §4a.

A consequence: for boards with many historical issues, loading all board issues is
mandatory. On a board with 2,000 issues this is a single efficient query (~100KB of
data), but it must be monitored.

#### 8.3 — No `any` Types

TypeScript `any` is prohibited throughout. All DTO interfaces must be fully typed.
The `boardConfig` sub-object in `SprintDetailResponse` should be a named interface
(`SprintDetailBoardConfig`) to prevent implicit `any` in the frontend.

#### 8.4 — ESM Import Convention

All backend imports use the `.js` extension suffix (e.g. `import { JiraSprint } from
'../database/entities/index.js'`). All new files in `backend/src/sprint/` must follow
this convention exactly.

#### 8.5 — `DataTable` Row Key

The existing `DataTable` component uses array index as the row key (`key={idx}`). For
the sprint detail view, `issue.key` (the Jira issue key) is stable and unique —
the `DataTable` component should be updated to accept an optional `rowKey` prop, or the
caller can use the array-index fallback. Since changing `DataTable` would affect all
consumers, the array-index behaviour is acceptable here and the `DataTable` component
is left unchanged.

---

## Alternatives Considered

### Alternative A — Add Detail Columns to the Existing Planning Table

Extend `SprintAccuracy` with per-issue breakdown data and render it as an expandable
row within the existing planning table.

**Rejected because:** per-sprint issue lists can contain 10–40 rows. Embedding a nested
table inside a table row creates significant accessibility and layout complexity, and
requires a fundamentally different component model than the existing `DataTable`.
A separate page is cleaner, naturally deep-linkable, and avoids bloating the planning
API response with per-issue data for every sprint in the page load.

### Alternative B — Extend an Existing Module (Planning or Roadmap)

Add the `GET /api/sprints/:boardId/:sprintId/detail` endpoint to the `PlanningModule`
or `RoadmapModule`.

**Rejected because:** the sprint detail view synthesises data from both planning
(membership reconstruction) and roadmap (JPD coverage) domains. Placing it in either
module creates an awkward dependency (planning importing JPD repositories, or roadmap
importing planning logic). A separate `SprintModule` has a clean dependency edge:
it imports entities from the database layer but has no module-level dependency on
`PlanningModule` or `RoadmapModule`.

### Alternative C — Client-Side Annotation Computation

Fetch raw sprint issues from an existing endpoint and compute annotations in the browser
using data already available from other API calls (roadmap accuracy, planning accuracy).

**Rejected because:** client-side computation would require the frontend to independently
implement sprint membership reconstruction from changelogs, CFR/MTTR rule evaluation,
and lead time calculation — all of which already exist as server-side logic. This
violates the principle that calculation logic lives in services. It would also require
multiple round-trip API calls (issues, changelogs, sprint data, board config, JPD ideas)
rather than a single typed endpoint.

---

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Database | None / Index check only | No schema changes. Verify `jira_changelogs(issueKey, field)` index; add if missing as an additive migration. |
| API contract | Additive | New endpoint `GET /api/sprints/:boardId/:sprintId/detail`. No existing endpoints changed. |
| Frontend | New page + navigation links in two tables | New `sprint/[boardId]/[sprintId]/page.tsx`. `sprintName` column in `planning/page.tsx` and `roadmap/page.tsx` gains a `<Link>` wrapper. `api.ts` gains new types and `getSprintDetail()`. |
| Tests | New unit tests for `SprintDetailService` | Require mocked repositories. Cover: membership replay (committed, added, removed), all annotation rules, empty sprint, Kanban rejection, missing boardConfig defaults. |
| Jira API | No new calls | All data is read from Postgres. No new Jira API endpoints. No rate-limit impact. |
| `AppModule` | Additive | `SprintModule` added to imports. |

---

## Acceptance Criteria

- [ ] `GET /api/sprints/PLAT/:sprintId/detail` returns `400 Bad Request` with a clear
      message for Kanban boards.
- [ ] `GET /api/sprints/ACC/nonexistent/detail` returns `404 Not Found`.
- [ ] `GET /api/sprints/ACC/:sprintId/detail` for a known sprint returns a
      `SprintDetailResponse` with correct `sprintId`, `sprintName`, `state`,
      `startDate`, `endDate`.
- [ ] The `issues[]` array excludes `issueType === 'Epic'` and `issueType === 'Sub-task'`.
- [ ] An issue present at sprint start has `addedMidSprint = false`.
- [ ] An issue whose first Sprint-field changelog pointing to this sprint has
      `changedAt > sprint.startDate + 5 minutes` has `addedMidSprint = true`.
- [ ] An issue created within 5 minutes of `sprint.startDate` has `addedMidSprint = false`.
- [ ] `roadmapLinked = true` iff `issue.epicKey ∈ coveredEpicKeys` (loaded from
      `JpdIdea.deliveryIssueKeys`).
- [ ] `roadmapLinked = false` when `issue.epicKey` is null.
- [ ] `isIncident = true` iff `issue.issueType ∈ boardConfig.incidentIssueTypes`
      OR `issue.labels` intersects `boardConfig.incidentLabels`.
- [ ] `isFailure = true` iff `issue.issueType ∈ boardConfig.failureIssueTypes`
      OR `issue.labels` intersects `boardConfig.failureLabels`.
- [ ] `completedInSprint = true` for an issue that transitioned to a `doneStatusName`
      within `[sprint.startDate, sprint.endDate]`.
- [ ] `completedInSprint = true` for an issue whose current status is in
      `doneStatusNames` (even without a matching changelog — covers the case where
      the changelog was truncated or missing).
- [ ] `completedInSprint = false` for an issue that reached a done status only after
      `sprint.endDate`.
- [ ] `leadTimeDays` is `null` for an issue with no done-status transition in the
      changelog.
- [ ] `leadTimeDays` is computed from `firstInProgressTransition → firstDoneTransition`
      when an In Progress transition exists.
- [ ] `leadTimeDays` falls back to `createdAt → firstDoneTransition` when no In Progress
      transition exists (Scrum fallback, not null).
- [ ] `summary.committedCount + summary.addedMidSprintCount` equals `issues.length`
      (every issue in the array is either committed or added).
- [ ] `summary.removedCount` correctly counts issues removed during the sprint window
      (these are NOT in `issues[]`).
- [ ] `summary.medianLeadTimeDays` is null when no issues have a computed `leadTimeDays`.
- [ ] `jiraUrl` for each issue equals `${JIRA_BASE_URL}/browse/${issue.key}`.
- [ ] `GET /api/sprints/ACC/:sprintId/detail` completes in under 500ms for a sprint with
      40 issues on a board with 500 total issues (performance regression guard).
- [ ] The frontend page `/sprint/ACC/:sprintId` renders the summary bar and issues table.
- [ ] Clicking a sprint name in the Planning page sprint table navigates to
      `/sprint/[boardId]/[sprintId]`.
- [ ] Clicking a sprint name in the Roadmap page sprint table navigates to
      `/sprint/[boardId]/[sprintId]`.
- [ ] The back-link navigates correctly based on the `?from=` query parameter.
- [ ] The issues table is sortable by all columns with sortable=true.
- [ ] The `jiraUrl` opens in a new tab (`target="_blank"`).
- [ ] No TypeScript `any` types are introduced in new files.
- [ ] All new backend files use `.js` ESM import suffixes.
- [ ] No new npm packages are added to `frontend/package.json`.
