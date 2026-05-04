# 0044 — Roadmap Coverage via Direct Jira Issue Links

**Date:** 2026-05-05
**Status:** Accepted
**Deciders:** Architect Agent
**Proposal:** [0041 — Roadmap Coverage via Jira Issue Links](../proposals/0041-roadmap-coverage-via-issue-links.md)

## Context

Roadmap coverage classification only considers the epic → JPD idea path: an issue is
on-roadmap only if its `epicKey` appears in the `epicIdeaMap` built from
`JpdIdea.deliveryIssueKeys`. Sprint issues linked directly to a roadmap item (e.g.
PT-389) via a Jira issue link such as "is connected to" always show
`roadmapStatus = 'none'`, suppressing legitimate coverage signal. The
`jira_issue_links` table is already populated during sync; the classification logic
simply never consults it for roadmap coverage.

## Options Considered

### Option A — Per-board `roadmapLinkTypes` allowlist in `BoardConfig`
- **Summary:** Add a `string[]` column to `BoardConfig`; at coverage-classification time, bulk-query `jira_issue_links` for qualifying links to known JPD idea keys.
- **Pros:** Consistent with existing `failureLinkTypes` pattern; per-board granularity; empty default is fully backward-compatible; no new Jira API calls; single bulk query (no N+1)
- **Cons:** Requires configuring per board even when all boards use the same link type name

### Option B — Implicit detection via `RoadmapConfig.jpdKey` prefix (no new config field)
- **Summary:** Treat any `jira_issue_links` row whose `targetIssueKey` has a prefix matching a `RoadmapConfig.jpdKey` as a roadmap link regardless of link type name.
- **Pros:** Zero configuration overhead
- **Cons:** Over-inclusive — teams link to roadmap items for reasons other than commitment ("blocks", "relates to"); inflates coverage figures; fragile against key prefix changes

### Option C — Denormalised `roadmapIdeaKey` column on `JiraIssue`
- **Summary:** Write the linked roadmap idea key directly onto `JiraIssue` during sync.
- **Pros:** Faster at query time
- **Cons:** Couples issue sync to roadmap state; `roadmapIdeaKey` becomes stale if a JPD idea is added/removed between syncs; schema coupling with no real query-time benefit given the existing indexes

## Decision

> We will add a per-board `roadmapLinkTypes: string[]` field to `BoardConfig` (Option A), bulk-query `jira_issue_links` at coverage-classification time, and surface connection method as `roadmapLinkSource: 'epic' | 'direct' | null` on the `SprintDetailIssue` response.

## Rationale

Option A is the only approach that avoids false coverage inflation while remaining
configurable. The `failureLinkTypes` field in `BoardConfig` establishes an identical
pattern that is already in production. An empty default means no existing board is
affected until explicitly configured. Adding `roadmapLinkSource` to the API response
(rather than deriving it on the frontend) keeps the resolution logic in one place and
enables per-connection-method visual indicators in the sprint detail UI without
duplicating the epic-vs-direct priority logic.

## Consequences

- **Positive:** Issues linked directly to roadmap items via configurable link types are
  correctly classified as on-roadmap. The sprint detail table can show distinct icons
  (`GitBranch` for epic, `Link2` for direct) so engineering leads can see at a glance
  how each issue's coverage was established.
- **Negative / trade-offs:** Each board must be configured individually with the
  relevant link type name(s). A single global default remains a future extension point.
- **Risks:** If Jira link type names vary across boards (capitalisation, exact string),
  operators must enter the exact string (matched case-insensitively). The Settings UI
  must document this clearly.

## Related Decisions

- [ADR 0003](0003-cfr-and-mttr-rules-per-board.md) — per-board CFR/MTTR rules; same configurability philosophy
- [ADR 0021](0021-jira-field-ids-externalised-to-yaml.md) — externalising Jira field identifiers
- [ADR 0041](0041-postgres-advisory-lock-for-sync-serialisation.md) — `jira_issue_links` already populated by sync
