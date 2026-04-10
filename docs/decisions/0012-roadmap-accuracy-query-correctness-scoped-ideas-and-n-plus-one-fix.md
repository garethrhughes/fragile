# 0012 — Roadmap Accuracy Query Correctness: Scoped Idea Loading and N+1 Elimination

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Decision Log Agent, implementation reviewed
**Proposal:** N/A

## Context

Two related correctness and performance defects were identified in
`roadmap.service.ts` and fixed together, as both concern how database queries are
structured in the accuracy calculation path:

1. **Unbounded JPD idea loading:** `jpdIdeaRepo.find()` was called with no `where`
   clause, returning every `JpdIdea` row ever synced — including ideas from JPD projects
   that are no longer referenced by any `RoadmapConfig`. This is a correctness problem
   (stale data from removed configs affects coverage calculations) and a performance
   risk (the result set is unbounded).

2. **N+1 issue queries in the sprint loop:** `calculateSprintAccuracy` was invoked
   inside a loop over sprints, and each invocation issued its own `issueRepo.find()`
   query. For a board with N sprints this produces N+1 database round-trips at query
   time. For a typical board with 20 sprints this means 20 issue queries per accuracy
   request.

Because both defects live in the same service method and share the same root cause
(query construction not accounting for the full data scope), they are recorded together.

## Options Considered

### Scoped Idea Loading

#### Option A — Scope `jpdIdeaRepo.find()` to configured project keys
- **Summary:** Load `RoadmapConfig` rows first; extract `jpdKey` values; pass them as
  `where: { jpdKey: In(jpdKeys) }` to `jpdIdeaRepo.find()`
- **Pros:**
  - `RoadmapConfig` is the authoritative, operator-managed list of active JPD projects
  - Removes stale ideas from removed configs without requiring a data migration or
    cascading delete on config removal
  - Bounded result set; query scales with configured projects, not accumulated history
- **Cons:**
  - If a config is removed and later re-added, ideas from the gap period will be
    excluded until the next sync re-populates them (correct behaviour, but may
    surprise operators)

#### Option B — Load all ideas; filter in application code after loading
- **Summary:** Load the unbounded set; discard ideas whose `jpdKey` is not in the
  configured set in memory
- **Pros:**
  - No change to the database query
- **Cons:**
  - All stale rows are still loaded from the database; scales with accumulated history
  - Does not fix the performance issue, only the correctness issue

### N+1 Issue Queries

#### Option A — Bulk-load all issues for all sprints before the loop
- **Summary:** Collect all `sprintId` values; execute a single
  `issueRepo.find({ where: { sprintId: In(sprintIds), boardId } })`; group results into
  a `Map<sprintId, JiraIssue[]>`; pass the pre-grouped slice to each
  `calculateSprintAccuracy` call
- **Pros:**
  - Reduces issue queries from N to 1 per accuracy request
  - No change to the `calculateSprintAccuracy` function signature semantics — it still
    receives a list of issues; they are simply pre-fetched
- **Cons:**
  - All issues for all sprints are loaded into memory simultaneously; for boards with
    very long sprint histories and large issue counts this increases memory pressure

#### Option B — Keep per-sprint queries; add an in-memory cache inside the loop
- **Summary:** Cache `issueRepo.find()` results by `sprintId` in a local `Map`; skip
  re-querying if the sprint was already loaded
- **Pros:**
  - Limits memory to the largest single sprint, not all sprints combined
- **Cons:**
  - Still issues one query per unique sprint; no improvement over the original
  - Adds complexity without addressing the fundamental N+1 pattern

#### Option C — Use a single SQL JOIN / subquery across sprints and issues
- **Summary:** Write a raw or QueryBuilder query that joins `sprints` and `issues` in
  one round-trip
- **Pros:**
  - Single round-trip; minimal application-layer memory
- **Cons:**
  - Introduces raw SQL into a TypeORM-managed codebase; harder to maintain
  - The `In()` bulk-load (Option A) achieves the same round-trip count with idiomatic
    TypeORM

## Decision

> We will scope `jpdIdeaRepo.find()` to the `jpdKey` values from active `RoadmapConfig`
> rows using `In(jpdKeys)`, and we will bulk-load all sprint issues in a single
> `issueRepo.find()` call before the sprint loop, grouping them into a `Map` for O(1)
> per-sprint slice access.

## Rationale

For the scoped idea loading, `RoadmapConfig` is the operator-controlled source of
truth for which JPD projects are active. Scoping the query to configured keys is the
correct boundary: it is simpler than application-layer filtering (Option B) and
eliminates the unbounded query at the database level. For the N+1 fix, a single
bulk `In()` query (Option A) is the idiomatic TypeORM solution and reduces round-trips
from N to 1 without raw SQL. The memory trade-off is acceptable: issue rows are small
and boards with 20+ closed sprints are the intended workload. Both fixes are in the
same service method and were applied together.

## Consequences

- **Positive:**
  - Roadmap accuracy calculations are no longer affected by ideas from removed JPD
    project configurations
  - For a typical board with 20 sprints, issue queries drop from 20 to 1 per accuracy
    request
  - The accuracy response time improves proportionally with sprint count
- **Negative / trade-offs:**
  - All sprint issues for the board are held in application memory simultaneously during
    the calculation; this is bounded by board size, which is considered acceptable
  - Removing a `RoadmapConfig` row does not delete its cached `JpdIdea` rows; stale rows
    remain in `jpd_ideas` until replaced by a new sync (cosmetic, not a correctness risk
    after this change)
- **Risks:**
  - If a board accumulates hundreds of sprints with very high issue counts, the bulk
    pre-load could become a memory concern; consider a sliding-window query or pagination
    if this becomes an issue

## Related Decisions

- [ADR-0002](0002-cache-jira-data-in-postgres.md) — Establishes that Jira data is
  cached in Postgres; query correctness at the cache layer is a direct consequence
- [ADR-0009](0009-roadmap-accuracy-jpd-sync-strategy.md) — Decision 4 (`RoadmapConfig`
  as the authoritative JPD project list) and Decision 5 (`jpd_ideas` caching) provide
  the schema context this fix operates within
