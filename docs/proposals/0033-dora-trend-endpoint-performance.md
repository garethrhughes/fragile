# 0033 — DORA Trend Endpoint Performance

**Date:** 2026-04-16
**Status:** Draft
**Author:** Architect Agent
**Related ADRs:** —

---

## Problem Statement

`GET /api/metrics/dora/trend` is the slowest endpoint in the system. An uncached request
with 8 quarters and 5 boards issues approximately **360 database queries** — because the
implementation calls `getDoraAggregate()` once per period, and each aggregate call fires
8–10 queries per board. Two rounds of in-memory caching (60 s for live quarters, 15 min for
historical) mask this on repeat page loads, but the cold-cache path (first load, post-sync,
or cache expiry) is visibly slow and will worsen as board count or limit grows.

Two additional inefficiencies compound the issue in the `LeadTime` and `MTTR` services:
changelog rows are loaded without a date-range filter and then discarded in memory, and all
issues for a board are loaded without a period constraint even when only a small window is
relevant. `DeploymentFrequency` and `CFR` already apply date-range filters correctly.

---

## Proposed Solution

Three targeted changes, each independently deployable and verifiable.

### Change 1 — Add date-range filters to LeadTime and MTTR changelog queries

**Problem:** `LeadTimeService.getLeadTimeObservations()` (lead-time.service.ts:96–101) and
`MttrService.getMttrObservations()` (mttr.service.ts:122–127) load *all* changelog rows for
a board's issues and filter in memory. For boards with long-lived issues and many transitions
this is unnecessary I/O.

**Fix:** Add `.andWhere('cl.changedAt >= :from')` to both changelog `createQueryBuilder`
calls. No `<= :to` upper bound — a transition that happened *before* the period start is
needed to determine initial state; only the lower bound can be safely pushed to the DB.

This mirrors the pattern already used in `DeploymentFrequencyService` and `CfrService`.

**Files changed:** `lead-time.service.ts`, `mttr.service.ts`
**Migration required:** No — uses existing `IDX_jira_changelogs_issueKey_field` index.

---

### Change 2 — Single bulk-load pass across all trend periods

**Problem:** `getDoraTrend()` calls `getDoraAggregate()` in a `Promise.all()` across N
periods. Even with per-period caching this means N independent DB round-trips on a cold
cache. The data set needed for a trend is predictable upfront: issues and changelogs for
each board across the full date span covered by all N periods combined.

**Fix:** Introduce a `TrendDataLoader` that, given a board ID and a date range spanning all
requested periods, loads issues and changelogs *once* per board. `getDoraTrend()` passes
this pre-loaded context into each metric service for the per-period slice instead of having
each service query the DB independently.

Concretely:

```
getDoraTrend(8 quarters, 5 boards)
  ├─ TrendDataLoader.load(boardId, rangeStart, rangeEnd)   ← 2 queries per board = 10 total
  │     issues = issueRepo.find({ boardId, createdAt >= rangeStart })
  │     changelogs = changelogRepo.find({ issueKey IN issues, changedAt >= rangeStart })
  │
  └─ For each of 8 periods (in parallel, no DB):
       DeploymentFrequencyService.calculateFromData(preloaded, periodStart, periodEnd)
       LeadTimeService.calculateFromData(preloaded, periodStart, periodEnd)
       CfrService.calculateFromData(preloaded, periodStart, periodEnd)
       MttrService.calculateFromData(preloaded, periodStart, periodEnd)
```

**Query count reduction:** ~360 → ~10 (2 per board, regardless of period count).

**Implementation approach:**
- Add `calculateFromData(data: TrendDataSlice, period: DateRange)` overloads alongside
  the existing `calculate(boardId, period)` methods. Existing single-period endpoints are
  unchanged.
- `TrendDataSlice` is a plain DTO: `{ issues: JiraIssue[], changelogs: JiraChangelog[], versions: JiraVersion[] }`.
- `getDoraTrend()` constructs the slice once per board, then fans out to per-period
  calculations purely in memory.
- Board config (`BoardConfig`) is already loaded once per aggregate call; it moves to once
  per `getDoraTrend()` call.

**Files changed:** `metrics.service.ts`, `deployment-frequency.service.ts`,
`lead-time.service.ts`, `cfr.service.ts`, `mttr.service.ts`, new
`trend-data-loader.service.ts`.

**Migration required:** No.

**Memory trade-off:** Loading 8 quarters of issues and changelogs for all boards at once
uses more working memory than 8 sequential loads. For typical boards (hundreds to low
thousands of issues) this is negligible. The `limit` cap of 20 periods and existing board
count (6 boards) bound the worst case to a manageable size.

---

### Change 3 — Elevate trend-level cache TTL for historical spans

**Problem:** The trend cache key includes `{ boardId, mode, limit }`, so the full trend
response is cached for 60 s regardless of whether all periods in it are historical. Once all
N periods are historical (i.e. the requested range is entirely in the past), the result is
immutable until a new sync runs.

**Fix:** After computing the trend result, inspect whether every period in it is historical.
If so, cache with `HISTORICAL_TTL_MS` (15 min) rather than the default 60 s. Use the
existing `DoraCacheService.isHistoricalQuarter()` helper for this check.

**Files changed:** `metrics.service.ts`
**Migration required:** No.

---

## Alternatives Considered

### Alternative A — PostgreSQL materialised views per metric per period

Pre-aggregate DORA metrics into a `dora_trend_cache` table on each sync and serve the trend
endpoint from that table. Eliminates all per-request calculation.

Ruled out because: requires a schema migration and a new sync step that would need to handle
partial syncs, backfill on first run, and invalidation on board config changes. Operational
complexity outweighs the benefit given that Change 2 achieves equivalent query reduction
without a schema change.

### Alternative B — Redis-backed distributed cache

Replace the in-memory TTL cache with Redis to share cached results across multiple API
instances.

Ruled out for now: the deployment target is single-instance (see proposal 0019/0027). The
in-memory cache is sufficient if the cold-cache latency is reduced by Change 2.

### Alternative C — Streaming / pagination of trend periods

Return the first 2–3 periods immediately and stream the rest. Improves perceived performance
but doesn't reduce total DB load.

Ruled out because: it hides the problem rather than fixing it, and adds frontend complexity.

---

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Database | None — no schema change | Changes 1–3 require no migrations |
| API contract | None | Trend endpoint signature unchanged |
| Frontend | None | No frontend changes required |
| Tests | New unit tests for `calculateFromData()` overloads; updated integration tests for trend | Existing single-period tests unaffected |
| Jira API | No new calls | |

---

## Open Questions

1. Should `TrendDataSlice` loading respect the issue-type exclusion rules already applied
   in each metric service (e.g. epic exclusion from proposal 0008), or should those filters
   remain in the per-metric `calculateFromData()` methods? Recommendation: keep filters in
   the metric methods for clarity and correctness isolation.

2. Is there a board with enough historical data to benchmark before/after query counts and
   wall-clock latency? A simple `console.time` wrapper around `getDoraTrend()` would
   confirm the expected reduction.

---

## Acceptance Criteria

- `GET /api/metrics/dora/trend` with 8 quarters and all 5+ boards issues ≤ 15 DB queries
  on a cold cache (verifiable via query logging).
- All existing Jest tests for `MetricsService`, `LeadTimeService`, `MttrService`,
  `DeploymentFrequencyService`, and `CfrService` pass without modification.
- The single-period aggregate endpoint (`GET /api/metrics/dora`) is unaffected in
  behaviour and performance.
- `calculateFromData()` methods are covered by unit tests using in-memory fixture data
  (no DB).
- Historical-only trend responses are cached for 15 minutes (verified by unit test on
  `DoraCacheService`).
