# 0076 — Admin-only ticket debug endpoint & page

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Architect Agent
**Proposal:** docs/proposals/0077-ticket-debug-page.md

## Context

Diagnosing why a metric looks wrong for a specific ticket required querying Postgres directly,
because there was no in-app view of the raw data the app has mirrored for a given issue key.
We need a read-only inspection view that shows everything stored for a key across several
entities (`JiraIssue`, `JiraChangelog`, `JiraIssueSprint`, `JiraIssueLink`, `JpdIdea`), without
touching the Jira API or the schema.

## Options Considered

### Option A — Dedicated `debug` module, admin-only, stored-data only
- **Summary:** New `DebugModule` with `GET /api/debug/issue/:key` (guarded by `AdminGuard`)
  and an admin-only `/debug` page; reads the Postgres mirror only.
- **Pros:** Isolated, easily removable; no schema change; no Jira rate-limit/latency risk;
  restricted to admins.
- **Cons:** A new module and endpoint to maintain.

### Option B — Add the endpoint to an existing module (`jira`/`sync`)
- **Pros:** No new module.
- **Cons:** The view spans entities no single domain module owns; muddies that module's
  responsibility.

### Option C — Include a live Jira fetch (stored vs live)
- **Pros:** Answers "why does Jira differ from us".
- **Cons:** Wider scope, Jira rate-limit/latency; not what was asked (see what is *stored*).

## Decision

We will add a dedicated, admin-only, read-only `debug` module exposing
`GET /api/debug/issue/:key`, which returns the `JiraIssue` plus its related `JiraChangelog`,
`JiraIssueSprint` (with sprint details), `JiraIssueLink` (as source and target), and linked
`JpdIdea` rows — reading only the Postgres mirror. Access is restricted with the existing
`AdminGuard`; the frontend `/debug` page and its sidebar entry are shown to admins only.

## Rationale

A dedicated module keeps a cross-entity concern out of the domain modules and makes it trivial
to remove later. Reading only stored data matches the request and avoids Jira rate-limit and
latency concerns. Reusing `AdminGuard` (as on `/api/users` and `/api/sync`) restricts a
data-dump endpoint to admins without introducing any new auth mechanism.

## Consequences

- **Positive:** Fast, in-app inspection of stored ticket data; no schema change; isolated.
- **Negative / trade-offs:** Exposes a full stored-data dump — mitigated by admin-only access
  and internal-only data (no PII).
- **Risks:** Low. If live comparison is needed later, add it as an explicit follow-up.

## Related Decisions

- Reuses `AdminGuard` (ADR 0068 — SSO auth + admin/user roles). Reads the Postgres mirror
  (ADR 0002). Data is internal class (no PII).
