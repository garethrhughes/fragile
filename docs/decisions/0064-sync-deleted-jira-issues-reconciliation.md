# ADR 0064 — Sync Deleted Jira Issues: Reconcile DB Against JQL Response

**Date:** 2026-05-15
**Status:** Accepted
**Proposal:** 0068-sync-deleted-jira-issues.md

## Context

`SyncService` upserts Jira issues into the DB but never deletes them. If an issue is
deleted in Jira after being synced, it persists indefinitely and inflates metrics.
Confirmed case: PLAT-1403 was deleted in Jira but existed in the DB with `status = Done`
and a done-transition in W20, causing pulse and week-detail to show 14 completions when
the correct number was 13.

## Decision

At the end of each **kanban** board sync, reconcile the DB against the full set of keys
returned by the JQL scan and hard-delete any issue not present in the response.

Cascade deletes must be performed explicitly (no FK constraints) for:
- `jira_changelogs` where `issueKey IN (deletedKeys)`
- `jira_issue_links` where `sourceIssueKey IN (deletedKeys)`
- `jira_issue_sprints` where `issueKey IN (deletedKeys)`

The deletion count is logged at INFO level per sync run.

**Scrum boards are out of scope for this ADR.** The scrum JQL
(`project = X AND sprint is not EMPTY`) does not return all historical issues — an issue
removed from all sprints would appear absent from the JQL response but might still be
valid history. Scrum deletion detection is deferred to a follow-up proposal.

## Alternatives Considered

- **Soft delete (`inDeleted` flag):** Adds filter complexity to every query. Hard delete
  is correct — a deleted Jira issue should not affect any metric.
- **Only reconcile on full sync:** Not applicable — kanban sync already fetches all
  issues on every run.

## Consequences

- PLAT-1403 (and any future phantom issues) will be removed from the DB after the next
  kanban sync run.
- Deletion is irreversible; a subsequent sync will re-add the issue if Jira ever returns
  it again.
- No API contract changes; no frontend changes required.
