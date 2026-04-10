# 0009 — Roadmap Accuracy: JPD Sync and Metric Calculation Strategy

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Architect Agent, implementation reviewed
**Proposal:** [docs/proposals/0001-roadmap-accuracy.md](../proposals/0001-roadmap-accuracy.md)

## Context

The Roadmap Accuracy feature adds a signal for whether sprint work is aligned to
Jira Product Discovery (JPD) roadmap ideas. Implementing it required several
non-obvious design choices around: how to fetch JPD data from Jira, how to store
delivery link associations, where to put epic-key information on existing issue
rows, how to configure which JPD projects to watch, and how to handle edge cases
such as Kanban boards, zero-denominator metrics, and sync failures. This ADR
records the decisions made and the rationale for each.

## Options Considered and Decisions

### Decision 1 — JPD ideas fetched via `/rest/api/3/search/jql`, not a JPD-specific API

**Context:** Jira Product Discovery does expose a dedicated `product-discovery` API
namespace. However, JPD ideas are also standard Jira issues stored in a project with
`projectTypeKey: "product_discovery"`.

**Options:**
- **A (chosen):** Use `GET /rest/api/3/search/jql?jql=project={jpdKey}&fields=summary,status,issuelinks` — the same JQL search endpoint already used by `searchIssues()`.
- **B:** Use the dedicated JPD REST API (`/rest/jpo/...` or similar product-discovery endpoints).

**Decision:** Option A.

**Rationale:** The standard JQL search API returns all fields needed (summary, status,
issuelinks) without requiring separate authentication scopes or a different client
abstraction. JPD-specific endpoints are less documented, vary between Jira Cloud
plans, and would require a new code path in `JiraClientService`. Reusing the existing
`JiraIssueSearchResponse` type and pagination pattern keeps the blast radius minimal.

---

### Decision 2 — Delivery links extracted from `issuelinks` with case-insensitive match on link type name containing "delivers"

**Context:** The link type connecting a JPD idea to a delivery epic is named `"Delivers"`
(outward) / `"is delivered by"` (inward) in most Jira tenants, but link type names are
operator-configurable and may differ in capitalisation (`"delivers"`, `"Is Delivered By"`).

**Options:**
- **A (chosen):** Match link type name with a case-insensitive comparison: check whether
  `type.outward.toLowerCase()` contains `"delivers"`, or `type.inward.toLowerCase()`
  contains `"is delivered by"`.
- **B:** Store one or more link type name strings in `RoadmapConfig` and allow operators
  to configure them.

**Decision:** Option A, with Option B deferred.

**Rationale:** Case-insensitive substring matching handles the known variation without
operator configuration overhead. The cost of a false positive (a link type that
incidentally contains "delivers") is low in practice. If a team reports missed links
due to a non-standard type name, Option B can be layered on top without a schema
redesign. The assumption is documented here so it is not forgotten.

---

### Decision 3 — `epicKey` stored as nullable column on `jira_issues`; not a boolean flag or join table

**Context:** To determine whether a story is covered by a JPD roadmap idea, the service
needs to know which epic the story belongs to, so it can cross-reference against the
set of epic keys that appear in `jpd_ideas.deliveryIssueKeys`.

**Options:**
- **A (chosen):** Add `epic_key VARCHAR NULL` to `jira_issues`. Set during sync via
  `fields.parent` (when parent `issuetype.name === 'Epic'`) or legacy `customfield_10014`.
- **B:** Add a `boolean` column `is_roadmap_linked` set to `true` when the sync detects
  the issue's epic is covered. Requires epics to be synced separately.
- **C:** A separate join table `issue_roadmap_links(issue_key, idea_key)` populated
  eagerly during sync.

**Decision:** Option A.

**Rationale:** Storing the raw `epicKey` is the narrowest additive change — it captures
the structural fact (which epic owns this story) without baking in any particular metric
interpretation. Option B collapses "is linked to a roadmap idea" into a boolean baked
at sync time, which means re-syncing is required whenever JPD idea links change, and
it cannot answer "which idea?" Option C is heavier schema infrastructure than the
problem warrants. Nullable varchar allows orphan stories (no epic) without a sentinel
value, and is consistent with how other optional Jira fields are stored.

---

### Decision 4 — `RoadmapConfig` table stores operator-configured JPD project keys; not hardcoded, not per-board in `BoardConfig`

**Context:** The system needs to know which Jira project(s) contain JPD ideas to sync.

**Options:**
- **A (chosen):** A dedicated `roadmap_configs` table with one row per JPD project key,
  managed via `GET/POST/DELETE /api/roadmap/configs`.
- **B:** Hardcode the JPD project key(s) in application configuration (`.env`).
- **C:** Add a `jpd_project_key` nullable column to `board_configs`, mapping each delivery
  board to exactly one JPD project.

**Decision:** Option A.

**Rationale:** Option B violates the design principle that board/project configuration is
stored in Postgres and loaded at runtime. Option C assumes a one-to-one relationship
between delivery boards and JPD projects, but in practice one JPD project may cover
multiple delivery boards, and a delivery board's epics may be tracked under multiple JPD
projects. A flat list of JPD keys to sync, combined with delivery-link cross-matching at
query time, handles many-to-many coverage without a join table.

---

### Decision 5 — `jpd_ideas` table caches synced ideas; `deliveryIssueKeys` stored as `simple-array`; not live-queried per request

**Context:** The service needs a list of epic keys associated with each JPD idea to build
the `coveredEpicKeys` set at query time.

**Options:**
- **A (chosen):** Cache synced ideas in a `jpd_ideas` Postgres table. Store
  `delivery_issue_keys` as a TypeORM `simple-array` column (comma-separated text).
- **B:** Query Jira live for JPD ideas on every `GET /api/roadmap/accuracy` request.
- **C:** Cache ideas but store `deliveryIssueKeys` in a normalised child table
  `jpd_idea_delivery_keys(idea_key, epic_key)`.

**Decision:** Option A.

**Rationale:** Option B adds 1–5 seconds of Jira API latency to every page load and
consumes rate-limit budget proportional to dashboard usage rather than sync frequency —
inconsistent with ADR-0002. Option C is over-engineered: the delivery key list is small
(typically 1–5 epics per idea), is read-only after sync, and is never queried with
`ANY()` or joined on the child key column. The `simple-array` approach keeps the schema
flat and the query path simple (`jpd_ideas.find()` → `flatMap deliveryIssueKeys`).

---

### Decision 6 — Sub-tasks and Epics excluded from `totalIssues` count entirely

**Context:** The `totalIssues` denominator for `roadmapCoverage` must represent
meaningful units of work. Stories and tasks are the primary units; the treatment of
epics and sub-tasks is ambiguous.

**Options:**
- **A (chosen):** Exclude both `issueType === 'Epic'` and `issueType === 'Sub-task'`
  from `totalIssues`.
- **B:** Exclude only Epics; include Sub-tasks (since they represent real work).
- **C:** Include all issue types and resolve epic-key for sub-tasks by walking the
  parent chain (sub-task → story → epic).

**Decision:** Option A.

**Rationale:** Epics are the linking unit (not the counted unit), so including them would
double-count the work they represent. Sub-tasks share their parent story's `epicKey`
only indirectly: `fields.parent.key` on a sub-task is the parent story, not the
grandparent epic. Walking the parent chain would require an extra database lookup per
sub-task. Excluding sub-tasks sidesteps this complexity and avoids double-counting
(a story and its sub-tasks represent the same unit of work). This is consistent with how
`PlanningService` treats sub-tasks.

---

### Decision 7 — Kanban boards return empty array; not a 400 error *(superseded by ADR-0010)*

> **Note:** This decision has been superseded by [ADR-0010](0010-kanban-roadmap-accuracy-via-changelog-board-entry-date.md).
> Kanban boards now return quarter-grouped accuracy rows using the changelog board-entry
> date rather than an empty array. Sprint-scoped requests (`?sprintId=`) for Kanban
> boards continue to return HTTP 400.

**Context:** The PLAT board is Kanban and has no sprints. `GET /api/roadmap/accuracy?boardId=PLAT`
must have a defined behaviour.

**Options:**
- **A (chosen at the time):** Detect `boardType === 'kanban'` and return `[]` (empty array, HTTP 200).
- **B:** Return HTTP 400 Bad Request with an explanatory message.
- **C:** Return HTTP 200 with a single aggregate row representing all issues on the board.

**Decision:** Option A *(at time of original writing)*.

**Rationale:** Consistent with ADR-0005, which establishes that Kanban boards are
excluded from sprint-based accuracy reports. An empty array is a valid, non-error
response that the frontend can interpret to show an appropriate message without parsing
an error body. HTTP 400 would require the frontend to treat roadmap accuracy differently
from planning accuracy for Kanban boards; a uniform `[]` response keeps the client
simpler. Option C is out of scope — roadmap accuracy is sprint-scoped by design.

---

### Decision 8 — `syncRoadmaps()` failures are non-fatal; logged as warnings, do not interrupt board sync

**Context:** `SyncService.syncAll()` runs board syncs and then calls `syncRoadmaps()`.
A missing or misconfigured JPD project key should not cause the entire sync to fail.

**Options:**
- **A (chosen):** Wrap `syncRoadmaps()` in a try/catch inside `syncAll()`; log the error
  as a warning; allow `syncAll()` to complete successfully.
- **B:** Let `syncRoadmaps()` throw; let `syncAll()` propagate the error, failing the
  entire sync job.

**Decision:** Option A.

**Rationale:** JPD project availability is orthogonal to delivery board sync. A JPD
project key that no longer exists, or a transient Jira API error, should not block
sprint data from being refreshed. Board sync failures are already handled per-board
with non-fatal logging; `syncRoadmaps()` follows the same pattern. Operators will see
the warning in logs and can diagnose via `GET /api/roadmap/configs`.

---

### Decision 9 — `roadmapCoverage` and `roadmapDeliveryRate` both return `0` when denominator is `0`

**Context:** For sprints with no issues (or no covered issues), the percentage
calculations would otherwise produce `NaN` or `Infinity`.

**Options:**
- **A (chosen):** Guard both calculations: `totalIssues > 0 ? ... : 0` and
  `coveredIssues > 0 ? ... : 0`.
- **B:** Return `null` to signal "not applicable" rather than `0`.

**Decision:** Option A.

**Rationale:** Returning `0` is consistent with how all other percentage metrics in the
system handle the zero-denominator case (e.g. planning accuracy, DORA metrics). The
frontend rendering logic does not need a special `null` branch; a `0` value renders
correctly in trend charts and tables. `null` would propagate optional-chaining
requirements into the response type and all downstream consumers.

---

## Consequences

- **Positive:**
  - Roadmap accuracy is computable from entirely cached Postgres data — no Jira API
    calls at query time.
  - The JPD sync pipeline reuses the existing `JiraIssueSearchResponse` type and
    pagination pattern, adding minimal new surface area to `JiraClientService`.
  - Kanban boards, zero-denominator sprints, and sync failures all have safe, defined
    behaviours.
  - Link type matching is resilient to casing variation without operator configuration.

- **Negative / trade-offs:**
  - `deliveryIssueKeys` stored as `simple-array` cannot be queried efficiently with SQL
    (`LIKE` only); if a future feature requires "find all ideas linked to epic X" via SQL,
    the column must be migrated to a normalised table.
  - The case-insensitive "contains delivers" heuristic could produce false positives if
    a tenant has an unrelated link type whose name contains the substring; this is
    judged unlikely but is not impossible.
  - Historical `jira_issues` rows will have `epic_key = NULL` until a full re-sync runs
    after the migration; the first roadmap accuracy report will show 0 % coverage for
    pre-migration sprints.

- **Risks:**
  - If the Jira tenant uses a non-standard link type name that does not contain
    "delivers", delivery links will be silently missed. Operators should verify link
    type names in Jira Admin if roadmap coverage appears unexpectedly low.

## Related Decisions

- [ADR-0002](0002-cache-jira-data-in-postgres.md) — Caching strategy that motivates the `jpd_ideas` table
- [ADR-0005](0005-kanban-boards-excluded-from-planning-accuracy.md) — Kanban exclusion pattern followed here
- [ADR-0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) — `BoardConfig.doneStatusNames` reused for in-sprint completion detection
