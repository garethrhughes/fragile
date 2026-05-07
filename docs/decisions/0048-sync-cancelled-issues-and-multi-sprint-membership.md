# 0048 — Sync: Include cancelled issues via JQL and persist multi-sprint membership

**Date:** 2026-05-06
**Status:** Accepted
**Deciders:** Architect Agent, User
**Proposal:** docs/proposals/0047-sync-cancelled-issues-and-multi-sprint-membership.md

## Context

Two sync defects were identified while debugging planning accuracy on ACC Sprint 2:

1. The agile per-sprint issue endpoint (`/rest/agile/1.0/board/{id}/sprint/{sid}/issue`)
   honours the board's saved JQL filter, which on every observed board excludes resolved
   issues (`Done`, `Closed`, `Cancelled`, `Released`). Resolved issues therefore never
   enter `allIssueKeys` and never have their changelogs refreshed, leaving stale rows
   with `NULL` `fromId` / `toId` for the `Sprint` field. ACC-45 (status `Cancelled`,
   member of three sprints in Jira) is the canonical example.
2. `JiraIssue.sprintId` is a single scalar column, but Jira issues can belong to
   multiple sprints simultaneously. Each sync overwrites this column with one arbitrary
   sprint ID, silently discarding the other memberships.

Together these bugs cause planning accuracy to under-count committed issues
(ACC Sprint 2 reports 16 instead of the true 17).

A prior proposal (0046) addressed only the symptom (planning accuracy) by sourcing the
committed set from Jira's undocumented Greenhopper sprint report API. That proposal was
rejected in favour of fixing the sync itself, which restores ADR 0006's changelog
reconstruction approach to full correctness.

## Options Considered

### Option A — Replace agile per-sprint fetch with JQL `/rest/api/3/search` + add `JiraIssueSprint` join entity
- **Summary:** Sync scrum boards via a single JQL query (`project = X AND sprint is not EMPTY`) that returns all issues regardless of resolution. Persist multi-sprint membership in a new `(issueKey, sprintId)` join table. Drop `JiraIssue.sprintId`. Stream pages to bound memory.
- **Pros:** Fixes both root causes; uses documented Jira REST API; net reduction in API calls per sync (one JQL search vs N agile per-sprint calls); changelog reconstruction (ADR 0006) becomes correct for all issue states; relational join table supports efficient queries against sprint date ranges.
- **Cons:** Requires full resync after deployment; per-issue transactions for `JiraIssueSprint` replacement increase transaction count; planning and sprint-detail read paths must change in the same release.

### Option B — Greenhopper sprint report API as authoritative source (Proposal 0046)
- **Summary:** Fetch `/rest/greenhopper/1.0/rapid/charts/sprintreport` for every closed sprint and persist `issueKeysAddedDuringSprint` to a new entity; planning service classifies from this set.
- **Pros:** Bypasses changelog reconstruction entirely for closed sprints; matches Jira's own UI numbers exactly.
- **Cons:** Depends on undocumented internal Atlassian API with deprecation risk; adds N HTTP calls per sync (one per closed sprint); does not fix the underlying agile-endpoint sync gap (any code path needing a complete `JiraIssue` table remains broken for cancelled issues); shadow data duplicates information already available via the changelog once IDs are populated.

### Option C — Keep agile endpoint, add targeted backfill for `NULL`-ID changelog rows
- **Summary:** Periodic job re-fetches changelogs for issues with `field = 'Sprint' AND fromId IS NULL`.
- **Pros:** Smallest code change.
- **Cons:** Treats the symptom not the cause; new cancelled issues continuously re-enter the broken state; does not address the multi-sprint membership bug.

### Option D — Store multi-sprint membership as JSON array on `JiraIssue`
- **Summary:** `sprintIds: string[]` JSON column instead of a join table.
- **Pros:** No new entity.
- **Cons:** Planning queries need to filter against `JiraSprint` date ranges and across multiple issues; in-application JSON filtering is harder to index and slower than a relational join.

## Decision

**Option A.** Replace the agile per-sprint issue fetch with a streaming JQL `/rest/api/3/search`
loop, and persist multi-sprint membership in a new `JiraIssueSprint` join entity. Drop the
`JiraIssue.sprintId` column in the same migration; no backwards-compatibility shim is
preserved. A full resync after deployment is the documented upgrade path.

The sync loop must stream pages — each page is upserted into `JiraIssue` and
`JiraIssueSprint` and only its issue keys are retained for the changelog phase. No issue
collection accumulates across pages. This protects the 2048 MB Fargate task memory
budget under the new strictly-larger result set.

If JQL search fails for a board, the sync run for that board fails with an `ERROR` log.
There is no fallback to the agile endpoint — silently falling back would re-introduce
the bug.

`PlanningService` and `SprintDetailService` switch to reading sprint membership from
`JiraIssueSprint` in the same release.

## Consequences

- ADR 0006 (sprint membership reconstructed from changelog) becomes correct for all
  issue states once IDs are populated for cancelled / resolved issues.
- The `closedSprintIds` / `closedSprintMap` / `isCarryOverFromSprint` machinery in
  `PlanningService` continues to work, now against complete data.
- Net Jira API call reduction per sync (one JQL search per board replaces ~5 per-sprint
  agile calls).
- Deployment requires a manual `POST /api/sync` immediately after migration; planning
  endpoints will return empty membership until the resync completes (minutes-scale).
- Per-issue transactions for `JiraIssueSprint` replacement increase Postgres transaction
  count; sync duration must be re-baselined post-deploy.
- Any future feature needing complete issue data (e.g. cycle-time analysis on cancelled
  issues) is unblocked without further sync changes.
