# 0078 — Incremental Jira Sync with SyncLog Watermark

**Date:** 2026-08-04
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Reviewer Agent, Infosec Agent
**Proposal:** docs/proposals/0078-incremental-jira-sync.md

## Context

The Jira sync (`SyncService.syncAll`) was full-only and ran once daily (`0 0 * * *`),
re-fetching every issue for every board plus all changelogs (delete + refetch per issue),
links, and sprint membership on every run — regardless of whether anything changed. Against
Jira Cloud rate limits (max 5 concurrent, 100 ms interval, backoff on 429) this is slow and
expensive, and the daily cadence leaves metrics up to 24 h stale. Most issues do not change
between runs, and Jira's enhanced search (`/rest/api/3/search/jql`) already accepts arbitrary
JQL with the `updated` field requested, so a `updated >= <watermark>` clause can fetch only
recently-changed issues.

## Options Considered

### Option A — SyncLog watermark + overlap buffer (chosen)
- **Summary:** Add an `incremental` sync mode (hourly cron) that, per board, appends
  `AND updated >= "<watermark>"` to the existing issue JQL, where the watermark is the latest
  successful `SyncLog.syncedAt` minus a configurable overlap buffer. Retain the daily full sync.
- **Pros:** No schema change on the hottest entity (`jira_issues`); reuses existing upsert
  paths; small, low-risk change; daily full sync remains the correctness/deletion backstop.
- **Cons:** Watermark is row-write time (coarser than Jira's per-issue `updated`); overlap
  buffer needed to avoid missing edge-of-window changes.

### Option B — Persist Jira `fields.updated` on `JiraIssue`; watermark = `max(jiraUpdatedAt)`
- **Summary:** Store Jira's own `updated` timestamp per issue and derive the watermark from it.
- **Pros:** More precise high-water-mark.
- **Cons:** Schema change + backfill on the largest, hottest table; `mapJiraIssue` change; more
  risk for marginal benefit given the daily full-sync backstop.

### Option C — Replace daily full sync with hourly incremental only
- **Summary:** Drop the full sync from the schedule; full only on manual trigger.
- **Cons:** Kanban phantom deletions and any drift accumulate indefinitely; no periodic
  correctness backstop. Rejected.

### Option D — Jira webhooks (push)
- **Summary:** Near-real-time updates via inbound webhooks.
- **Cons:** New public inbound endpoint (attack surface behind WAF), webhook secret management,
  delivery-reliability handling — far larger than the requested feature. Deferred.

## Decision

We will add an `incremental` sync mode (hourly cron `0 * * * *`) that appends
`AND updated >= "<watermark>"` to the scrum and kanban issue JQL, where the per-board watermark
is the latest **successful** `SyncLog.syncedAt` minus `INCREMENTAL_SYNC_OVERLAP_MINUTES`
(default 5). The daily full sync (`0 0 * * *`) is retained unchanged as the correctness and
kanban phantom-deletion backstop. `POST /api/sync?mode=full|incremental` exposes the choice,
defaulting to `full`. `SyncLog` gains a `syncType` column (`'full' | 'incremental'`, default
`'full'`). A board with no prior successful sync falls back to a full sync. The watermark is
formatted for JQL in the configured `TIMEZONE` (Jira interprets unqualified JQL datetimes in
the account timezone), not UTC.

## Rationale

Option A delivers the cost saving with the least risk: no change to `jira_issues`, reuse of
existing PK-keyed upsert paths, and the nightly full sync continues to guarantee correctness
(including deletion reconciliation, which requires a full JQL scan and is therefore skipped on
incremental runs). The overlap buffer plus the daily backstop compensate for the coarser
row-write-time watermark. Formatting the watermark in the configured timezone avoids a
multi-hour window shift for non-UTC Jira accounts.

## Consequences

- **Positive:** Hourly refresh at a fraction of the Jira API cost; fresher metrics during the
  working day; no new dependency, no new cloud resource, no new exposure.
- **Negative / trade-offs:** Incremental runs do not detect deletions or refresh kanban backlog
  membership (deferred to the daily full sync); watermark precision is bounded by row-write time
  plus the overlap buffer.
- **Risks:** If the overlap buffer is set too small relative to clock skew, an update could be
  missed until the next full sync — mitigated by the default 5-minute buffer and the daily
  full-sync backstop. Revisit with Option B if precision proves insufficient.

## Related Decisions

- ADR 0036 — Sync endpoint fire-and-forget HTTP 202 (unchanged; `?mode` added).
- ADR 0041 — Postgres advisory lock serialises sync runs (makes the midnight cron collision a
  no-op).
- ADR 0040 — DORA snapshots computed post-sync (same trigger path after both modes).
- ADR 0064 / proposal 0068 — Kanban phantom-deletion reconciliation (full-sync-only under this
  decision).
- ADR 0067 — Kanban backlog membership (full-sync-only under this decision).
- ADR 0048 — Sync includes cancelled issues; multi-sprint membership persisted (upsert paths
  reused).
