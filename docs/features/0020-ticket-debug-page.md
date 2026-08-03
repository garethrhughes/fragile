# 0020 — Ticket Debug Page

**Date:** 2026-08-03
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0077-ticket-debug-page.md

## Summary

An admin-only **Debug** page where an operator enters a Jira ticket key and sees everything
currently stored in our Postgres mirror about that ticket — the issue row plus all related
changelog, sprint-membership, issue-link, and roadmap-idea data — as structured sections and
a raw JSON dump.

## Background / Motivation

When a metric looks wrong for a specific ticket (e.g. a sprint-membership reconstruction, a
roadmap link, or a support classification), there is currently no quick way to inspect the
raw stored data for that key. Diagnosis means querying Postgres directly. A read-only debug
view of the mirrored data lets an admin verify, in one place, exactly what the app has stored
and therefore what the metric calculations are operating on.

## Scope

**In scope**

- New backend read-only endpoint returning all stored data for a given issue key:
  - the `JiraIssue` row
  - `JiraChangelog` rows for the key (status and Sprint transitions), ordered by `changedAt`
  - `JiraIssueSprint` membership rows for the key, with the referenced `JiraSprint` details
  - `JiraIssueLink` rows where the key is the **source** and where it is the **target**
  - any linked `JpdIdea` / roadmap idea (via `epicKey` and via direct issue links)
- New admin-only frontend `/debug` page: a key input, structured sections, and a collapsible
  raw JSON blob of the whole payload for copy/paste.
- Sidebar entry in the bottom **User** section (with Settings & Users), shown to admins only.
- Typed `lib/api.ts` wrapper for the new endpoint.

**Out of scope**

- Any live Jira API call — the page shows only what is mirrored in Postgres.
- Editing, re-syncing, or deleting data (read-only view only).
- Cross-ticket search, filtering, or bulk views — single key at a time.
- Diffing stored vs. live Jira.

## Acceptance Criteria

- Given a valid, stored issue key, when `GET /api/debug/issue/:key` is called by an admin,
  then it returns 200 with the issue row and all related changelog, sprint-membership,
  issue-link (source and target), and roadmap-idea data.
- Given an unknown key, when the endpoint is called by an admin, then it returns 404.
- Given a non-admin (or unauthenticated) caller, when the endpoint is called, then it returns
  403 (guarded by the existing `AdminGuard`), consistent with `/api/users` and `/api/sync`.
- Given an admin user, when they view the sidebar, then a **Debug** link appears in the bottom
  User section; non-admins do not see it.
- Given the `/debug` page, when an admin enters a key and submits, then the page renders the
  structured sections and a collapsible raw JSON view of the full payload.
- Given an unknown key entered on the page, then a clear "not found" empty state is shown.
- The endpoint performs no live Jira calls and issues bulk/scoped queries only (no N+1);
  all `find` calls are constrained by the key.
- The page fetches data exclusively through a typed wrapper in `frontend/src/lib/api.ts`.

## Open Questions

- Should the raw JSON be expanded or collapsed by default? (Proposed: collapsed, with a
  one-click expand/copy.) To be confirmed at design.

## Notes

- Reuse the existing `AdminGuard` (`backend/src/auth/guards/admin.guard.ts`) applied via
  `@UseGuards(AdminGuard)` — the same pattern as `UsersController`, `SyncController`, and
  `BoardsController`.
- Frontend admin gating uses `isAdmin` from `useAuth`, matching how Settings and Users links
  are rendered in the sidebar's bottom section.
- Issue-keyed entities: `JiraIssue` (PK `key`), `JiraChangelog` (`issueKey`, indexed),
  `JiraIssueSprint` (`issueKey`, indexed), `JiraIssueLink` (`sourceIssueKey` indexed; also
  matchable as `targetIssueKey`), `JpdIdea` (linked via `epicKey` / direct issue links).
- Internal-only tool; all data is internal-class mirrored Jira data (no PII). No new auth
  mechanism — only reuse of the existing guard.
