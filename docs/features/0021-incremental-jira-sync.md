# 0021 — Incremental Jira Sync

**Date:** 2026-08-04
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0078-incremental-jira-sync.md

## Summary

Add an **incremental** Jira sync that runs hourly and fetches only issues changed since the
last successful sync (JQL `updated >= <watermark>`), refreshing changelogs, issue links, and
sprint membership only for those changed issues. The existing **full** sync is retained,
still runs daily at midnight, and remains the correctness backstop (including kanban
phantom-deletion reconciliation).

## Background / Motivation

The current sync is full-only. On every run it re-fetches every issue for every board, then
deletes and re-fetches all changelog pages per issue, re-persists all issue links, and
re-computes sprint membership — regardless of whether anything changed. It runs once daily
(`0 0 * * *`). For large boards this is slow and makes many redundant Jira API calls, which
is expensive against Jira Cloud rate limits (max 5 concurrent, 100 ms interval, backoff on
429).

Most issues do not change between runs. Jira's enhanced search API (`/rest/api/3/search/jql`)
already accepts arbitrary JQL and the `updated` field is already requested — so a
`updated >= <watermark>` clause lets us fetch only the small set of recently-changed issues.
This makes an hourly refresh cheap enough to run, giving fresher metrics during the working
day, while the nightly full sync continues to catch deletions and any drift.

## Scope

**In scope**

- A new **incremental** sync mode in `SyncService` that, per board, appends a
  `updated >= "<watermark>"` clause to the existing issue JQL and processes only the returned
  (changed) issues through the existing upsert / changelog / links / sprint-membership paths.
- A per-board **watermark**: the `syncedAt` of the most recent `SyncLog` with
  `status = 'success'` for that board, minus a fixed **overlap buffer** to avoid missing
  edge-of-window changes. Configurable via a new env var (default e.g. 5 minutes).
- A `syncType` column on `SyncLog` (`'full' | 'incremental'`), defaulting to `'full'` for
  backward compatibility; watermark lookup considers successful runs of either type.
- A new **hourly cron** (`0 * * * *`) registered alongside the existing daily job that runs
  the incremental sync. The daily midnight job continues to run a **full** sync unchanged.
- **Full-sync fallback for first run:** if a board has no prior successful `SyncLog`, the
  incremental run performs a full sync for that board instead.
- `POST /api/sync?mode=full|incremental` — `mode` defaults to `full` (preserves current
  behaviour). Invalid values rejected via validation.
- DORA snapshots continue to be computed after both sync modes (unchanged trigger path).
- Sprint metadata and versions continue to be refreshed each run (cheap; not date-filtered).

**Out of scope**

- Persisting Jira's own `fields.updated` onto `JiraIssue` (the entity's `updatedAt` is a
  TypeORM DB-write column). We use the `SyncLog` watermark instead — no schema change to the
  hottest entity.
- Changing kanban phantom-deletion reconciliation. Deletion detection requires a full JQL
  scan and remains **only** in the full sync (daily). Incremental runs do not detect deletions.
- Incremental changelog fetching. For each changed issue we still fully replace its changelog
  (existing behaviour); we simply touch far fewer issues.
- Any change to the advisory-lock serialisation, roadmap/JPD sync, or the Lambda snapshot
  logic.
- Frontend changes beyond what already surfaces sync status (the existing status view is
  unaffected; surfacing `syncType` in the UI is not required for this feature).

## Acceptance Criteria

- Given a board with a prior successful sync, when the incremental sync runs, then the issue
  JQL includes `updated >= "<lastSuccessfulSyncedAt − buffer>"` and only issues returned by
  that query are upserted and have their changelog/links/sprint-membership refreshed.
- Given a board with **no** prior successful `SyncLog`, when the incremental sync runs, then
  it falls back to a full sync for that board.
- Given the incremental sync completes for a board, then a `SyncLog` row is written with
  `status = 'success'`, `syncType = 'incremental'`, and the count of issues processed.
- Given the watermark lookup, when selecting the last sync time, then only `SyncLog` rows with
  `status = 'success'` are considered, and the applied watermark is that time minus the
  configured overlap buffer.
- Given `POST /api/sync?mode=incremental`, when called, then an incremental sync is started
  (fire-and-forget HTTP 202); given `mode=full` or no `mode`, a full sync is started
  (unchanged); given an invalid `mode`, then HTTP 400.
- Given the daily midnight cron, when it fires, then it runs a **full** sync (unchanged),
  including kanban phantom-deletion reconciliation.
- Given a new hourly cron, when it fires on the hour (and not colliding with an in-progress
  sync — existing advisory lock/`409` semantics apply), then it runs an incremental sync.
- Given the `SyncLog` migration, then it adds a nullable/defaulted `syncType` column with both
  `up()` and `down()` implemented; existing rows default to `'full'`.
- DORA snapshots are computed after an incremental sync using the same trigger path as full
  sync.
- Unit tests cover: watermark computation (including buffer and status filtering), first-run
  full-sync fallback, JQL clause construction, and mode selection on the endpoint. No test
  hits a real network.

## Open Questions

- **Overlap buffer default:** proposed 5 minutes. To confirm at design.
- **Hourly schedule vs midnight collision:** the hourly cron (`0 * * * *`) will fire at
  midnight alongside the daily full cron (`0 0 * * *`). The existing advisory lock will make
  the second arrival a no-op (or 409 on manual). Proposed: accept this — the incremental run
  simply finds the lock held and skips. To confirm the exact skip behaviour at design.
- **Env var name:** proposed `INCREMENTAL_SYNC_OVERLAP_MINUTES` (default 5). To confirm.

## Notes

- Watermark source is `SyncLog.syncedAt` (a `@CreateDateColumn`), filtered to
  `status = 'success'`. This avoids the schema change of persisting Jira's `fields.updated`
  on `JiraIssue`, at the cost of a coarser (row-write-time based) high-water-mark — mitigated
  by the overlap buffer and the daily full-sync backstop.
- The JQL passthrough already exists: `searchIssues(jql, …)` in `JiraClientService` forwards
  arbitrary JQL, and both scrum and kanban issue queries already `ORDER BY updated DESC` and
  request the `created,updated` fields — only the `WHERE` clause needs augmenting.
- Scrum JQL today: `project = "<board>" AND sprint is not EMPTY ORDER BY updated DESC`
  (`sync.service.ts` ~L535). Kanban JQL today:
  `project = <board> ORDER BY updated DESC` (~L406). Incremental appends
  `AND updated >= "<watermark>"` to each.
- Upserts are keyed by PK (`JiraIssue.key`), so a partial (changed-only) fetch merges cleanly
  into existing rows without disturbing untouched issues.
- Cron is registered imperatively in `onModuleInit` via `SchedulerRegistry` + `CronJob` (not
  `@Cron` decorators) — the hourly job is added the same way under a new job name.
- Config must be read via `ConfigService` (per project rules), not `process.env`.
- Internal-only tool; mirrored Jira data (no PII). No new external integration, no new cloud
  resource, no auth change (`POST /api/sync` keeps its existing `AdminGuard`).
