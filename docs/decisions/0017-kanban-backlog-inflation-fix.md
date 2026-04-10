# 0017 — Kanban Backlog Inflation Fix: statusId Storage, Per-Board Backlog Config, and Two-Tier Exclusion Logic

**Date:** 2026-04-11
**Status:** Accepted
**Deciders:** Decision Log Agent, implementation reviewed (commit `4c74ca1`)
**Proposal:** [0005 — Kanban Planning Accuracy](../proposals/0005-kanban-planning-accuracy.md)

## Context

The PLAT board uses a Kanban workflow. The Jira project contains two distinct statuses
that both carry the display name **"To Do"**:

| Status ID | Display name | Meaning |
|---|---|---|
| 10303 | To Do | True backlog — issues never pulled onto the board; 142 issues, no changelog |
| 11249 | To Do | "Selected for Development" — active board column; 9 issues, have changelogs |

Because the sync service stored only `fromString`/`toString` (display names) and not
the numeric status ID, both statuses collapsed to the string `"To Do"` in the database.
As a result, all three Kanban flow-metric services (`PlanningService`,
`RoadmapService.getKanbanAccuracy()`, `QuarterDetailService`) included all 151
"To Do" issues — the 142-issue true backlog plus the 9 active board issues — in
calculations that should only reflect issues actually on the board. This inflated PLAT's
Q2 2026 figure from the correct ~9–18 on-board issues to 151.

The root cause is that **Jira status display names are not unique within a project**.
Two statuses with the same display name but different semantic roles cannot be
distinguished without the numeric status ID. This constraint forced changes at three
layers: the data model (store the ID), the board configuration (declare which IDs are
backlog-only), and the service logic (apply the exclusion with a fallback for
pre-migration data).

---

## Decision 1 — Store `statusId` on `jira_issues`

### Options Considered

#### Option A — Store `statusId` as a nullable VARCHAR column
- **Summary:** Populate `jira_issues.statusId` from `raw.fields.status.id` during sync
- **Pros:**
  - The numeric ID is the stable, unambiguous Jira identifier; display names are not
  - Nullable allows a gradual rollout: existing rows remain valid until the next sync
  - Minimal schema change; one column, one index
- **Cons:**
  - Requires a migration and a sync-service change before the data is available
  - Pre-migration rows will have `statusId = NULL`, requiring a fallback path in services

#### Option B — Store the full status object as JSONB
- **Summary:** Replace the `status` string column with a JSONB column containing `{id, name, ...}`
- **Pros:**
  - Richer data; future-proof for further status attributes
- **Cons:**
  - Breaking change to a heavily-queried column; all services and queries must be updated
  - Overkill: only the ID is needed to resolve the ambiguity
  - Harder to filter/index than a plain string column

#### Option C — Infer backlog membership from column position in the board config JSON
- **Summary:** Parse the board's `columnConfig` from the Jira board configuration API to
  determine which status IDs map to which visual columns
- **Pros:**
  - No change to `jira_issues` schema
- **Cons:**
  - Requires a separate board-config sync step
  - Board config JSON format varies between Jira Cloud and Server
  - Fragile: column positions are not a reliable proxy for "is this backlog?"

### Decision

> We will add a nullable `statusId` (VARCHAR) column to `jira_issues`, populated from
> `raw.fields.status.id` during the issue sync. Migration:
> `1775820878077-AddStatusIdToJiraIssues`.

### Rationale

The numeric status ID is the authoritative, stable identifier Jira uses for a status
regardless of how it is renamed. Option B is rejected as overkill; only the ID field is
required to break the ambiguity. Option C is rejected as fragile and requiring an
additional sync dependency. The nullable column allows the fix to ship without a forced
full re-sync: existing data can still be handled via the fallback path described in
Decision 3.

---

## Decision 2 — Per-Board `backlogStatusIds` Configuration on `BoardConfig`

### Options Considered

#### Option A — `backlogStatusIds: string[]` field on `BoardConfig`
- **Summary:** Add a `simple-json` array column (default `[]`) to `board_configs`; boards
  declare which status IDs represent pure backlog (never-on-board) items via
  `PUT /api/boards/:boardId/config`
- **Pros:**
  - The backlog/board boundary is board-specific; per-board config is the correct scope
  - Consistent with the `BoardConfig`-as-composition-point pattern (ADR-0003, ADR-0015)
  - Empty-list-means-disabled convention makes it backwards-compatible
  - Configurable at runtime without code changes or deployments
- **Cons:**
  - Requires explicit configuration for each affected board; misconfigured boards fall
    back to the changelog-presence heuristic, not an error

#### Option B — Hardcode the backlog status ID list in service code
- **Summary:** Each Kanban service hard-references the known backlog status IDs
- **Pros:**
  - No schema or config change needed
- **Cons:**
  - Not maintainable: different Jira projects have different status ID namespaces
  - Requires a code deployment to update when a board adds a new backlog-equivalent status
  - Violates ADR-0003's principle: metric rules must not be hardcoded in services

#### Option C — Global default backlog status ID list in application config
- **Summary:** A single `BACKLOG_STATUS_IDS` environment variable or config entry applied
  to all boards
- **Pros:**
  - One configuration entry covers all boards
- **Cons:**
  - Different Jira projects use different status IDs; a global list cannot be correct
    for multiple boards simultaneously
  - Conflates board-specific semantics into a shared namespace

### Decision

> We will add a `backlogStatusIds: string[]` field (TypeORM `simple-json`, column default
> `'[]'`) to the `BoardConfig` entity. Boards declare which Jira status IDs represent
> pure-backlog items. Migration: `1775820879077-AddBacklogStatusIds`.
> PLAT is configured with `backlogStatusIds: ["10303"]`.

### Rationale

The per-board database configuration approach (Option A) is the only option that is both
correct across heterogeneous Jira projects and operable without code deployments. It
extends the existing `BoardConfig`-as-composition-point pattern established by ADR-0003
and ADR-0015. The empty-list default preserves backwards compatibility for all boards
currently in production.

---

## Decision 3 — Two-Tier Exclusion Logic in Kanban Services

### Options Considered

#### Option A — Primary path (statusId) + fallback (changelog presence)
- **Summary:** If `backlogStatusIds` is configured AND `issue.statusId` is non-null,
  exclude the issue when `statusId ∈ backlogStatusIds`. Otherwise, exclude issues that
  have no status changelog at all.
- **Pros:**
  - The fallback immediately fixes the bug for existing data without requiring a re-sync
  - The primary path activates automatically after the next sync, requiring no further
    operator action
  - The two paths degrade gracefully: boards without `backlogStatusIds` config and boards
    whose issues have not been re-synced both get reasonable results
- **Cons:**
  - Slightly more complex service logic: two conditional branches per service
  - The fallback heuristic (no changelog = backlog) may be incorrect for edge cases such
    as issues created directly in `In Progress`

#### Option B — Migration-only fix (no fallback)
- **Summary:** Apply the `statusId` exclusion only; do not fall back; require a full
  re-sync before the fix is active
- **Pros:**
  - Single code path; simpler logic
- **Cons:**
  - The fix is inert until every issue has been re-synced; the backlog inflation bug
    persists for all pre-migration rows in the meantime

#### Option C — Changelog-presence heuristic only (no statusId path)
- **Summary:** Permanently exclude issues with no status changelog, without using statusId
- **Pros:**
  - No schema migration needed; works immediately on existing data
- **Cons:**
  - Loses precision once `statusId` is available; the heuristic cannot distinguish a
    legitimate new issue from a backlog-only item if both lack a changelog
  - Cannot be refined per board; is global and implicit

### Decision

> All three Kanban services (`planning.service.ts`, `roadmap.service.ts`,
> `quarter-detail.service.ts`) apply a two-tier exclusion:
>
> - **Primary (post-sync):** if `backlogStatusIds.length > 0` AND `issue.statusId` is
>   non-null → exclude if `issue.statusId ∈ backlogStatusIds`
> - **Fallback (pre-migration):** if `issue.statusId` is null (or `backlogStatusIds` is
>   empty) → exclude issues that have no status changelog entry at all

### Rationale

The fallback is essential for operational correctness: without it, the fix requires
downtime or a forced full re-sync before it takes effect. Once re-sync completes, the
primary path takes over automatically and the fallback becomes a no-op for all rows.
Option B is rejected because it leaves a broken metric visible to users for the duration
of the re-sync window. Option C is rejected because it permanently forfeits the
precision that `statusId` provides and cannot be tuned per board.

---

## Decision 4 — Fix `data-source.ts` to Reference `dist/` Paths

### Context

This decision is a supporting infrastructure fix required for the migrations in Decisions
1 and 2 to run correctly.

### Options Considered

#### Option A — Reference `dist/` compiled output in entity and migration globs
- **Summary:** Change entity/migration globs in `src/data-source.ts` from
  `src/**/*.entity{.ts,.js}` to `dist/**/*.entity.js` (and similarly for migrations)
- **Pros:**
  - `migration:run` executes `dist/data-source.js` via Node.js without ts-node; compiled
    paths are the only paths Node.js can resolve in that context
  - Consistent with how all other compiled NestJS artifacts are loaded at runtime
- **Cons:**
  - `dist/` must be built before running migrations; `migration:run` without a prior
    `build` will fail

#### Option B — Use `ts-node` for `migration:run`
- **Summary:** Wrap `migration:run` with `ts-node -r tsconfig-paths/register` so that
  `src/*.ts` paths can be used directly
- **Pros:**
  - No distinction between `src/` and `dist/` paths at any point
- **Cons:**
  - Adds `ts-node` as a runtime dependency for database operations; increases migration
    environment complexity
  - TypeORM CLI and ts-node path resolution interact with NestJS path aliases in
    non-obvious ways; the existing pipeline already builds before migrating

### Decision

> Change `src/data-source.ts` entity and migration globs to reference `dist/` compiled
> output: `dist/**/*.entity.js` and `dist/migrations/*.js`.

### Rationale

The `migration:run` script compiles to `dist/data-source.js` and is invoked via plain
Node.js. When the file referenced `src/*.ts` paths, Node.js attempted to load raw
TypeScript and failed with a syntax error. Since the project already runs `build` before
`migration:run` in its pipeline, Option A is the lowest-friction fix with no new
dependencies. Option B introduces operational complexity without benefit in a project
where the build step is already mandatory.

---

## Consequences

### Positive

- PLAT Q2 2026 now correctly reflects 18 on-board issues (down from 151 inflated by
  backlog items); flow metrics are trustworthy for Kanban boards
- The `backlogStatusIds` field follows the `BoardConfig`-as-composition-point pattern:
  operators can tune the backlog boundary for any board without a code deployment
- The two-tier fallback means the fix is immediately effective for production data and
  becomes more precise after re-sync, with no operator intervention required
- The `dist/` path fix is a one-time correction that prevents all future migration runs
  from failing with a TypeScript-syntax error

### Negative / Trade-offs

- Boards that have `backlogStatusIds` unconfigured AND whose issues have no status
  changelogs will have those issues excluded (they are treated as backlog by the
  fallback heuristic). Issues created directly into an active status with no subsequent
  transition could be incorrectly excluded; this is an edge case but not impossible
- The fallback changelog-presence query adds one extra database round-trip per Kanban
  service invocation until `backlogStatusIds` is configured for every board and all
  issues have been re-synced
- `dist/` must be built before running migrations; a developer who runs `migration:run`
  without `build` will see a "no such file" error from Node.js

### Risks

- If Jira renumbers status IDs during a project reconfiguration (rare but possible),
  `backlogStatusIds` entries will silently become stale and stop filtering. Operators
  should re-verify `backlogStatusIds` after any Jira workflow reconfiguration
- The `statusId` column on `jira_issues` will be `NULL` for any issue not yet re-synced.
  Services must continue to handle `NULL` gracefully; any future query that assumes
  `statusId` is always populated will be incorrect until a full re-sync is confirmed

---

## Key Implementation Details

### Two-tier filter pseudocode (identical across all three services)

```typescript
const onBoardIssues = allIssues.filter((issue) => {
  if (backlogStatusIds.length > 0) {
    // Primary path: use statusId if available
    if (issue.statusId !== null) {
      return !backlogStatusIds.includes(issue.statusId);
    }
    // statusId is null (pre-migration) — fall through to changelog heuristic
  }
  // Fallback: exclude issues with no status changelog at all
  return issueKeysWithChangelog.has(issue.key);
});
```

### Migrations

| Migration | Table | Change |
|---|---|---|
| `1775820878077-AddStatusIdToJiraIssues` | `jira_issues` | Adds `statusId VARCHAR NULL` |
| `1775820879077-AddBacklogStatusIds` | `board_configs` | Adds `backlogStatusIds TEXT NOT NULL DEFAULT '[]'` |

### `data-source.ts` path change

```diff
- entities: ['src/**/*.entity{.ts,.js}', 'src/database/entities/*.entity{.ts,.js}'],
- migrations: ['src/migrations/*{.ts,.js}'],
+ entities: ['dist/**/*.entity.js', 'dist/database/entities/*.entity.js'],
+ migrations: ['dist/migrations/*.js'],
```

---

## Related Decisions

- [ADR-0002](0002-cache-jira-data-in-postgres.md) — The backlog inflation bug only
  existed because Jira data is cached in Postgres; fixing it required a schema migration
  rather than a query-time API call
- [ADR-0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) — Establishes the
  `BoardConfig`-per-board-rules pattern that `backlogStatusIds` extends
- [ADR-0010](0010-kanban-roadmap-accuracy-via-changelog-board-entry-date.md) — The
  `fromValue = 'To Do'` changelog heuristic used as the board-entry date signal is the
  same one repurposed here as the fallback exclusion indicator
- [ADR-0015](0015-board-config-as-metric-filter-composition-point.md) — `backlogStatusIds`
  is a new filter dimension on `BoardConfig` following the composition-point pattern; the
  empty-list-means-disabled convention is carried forward unchanged
- [ADR-0016](0016-quarter-detail-view.md) — `QuarterDetailService` is one of the three
  services patched by this decision; the quarter-bucketing logic it contains is unaffected
