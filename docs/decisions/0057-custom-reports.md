# 0057 — Custom Reports

**Date:** 2026-05-08
**Status:** Accepted
**Deciders:** Architect Agent
**Proposal:** [0056](../proposals/0056-custom-reports.md)

## Context

The dashboard exposes a fixed set of opinionated reports tied to Jira-synced data. There
is no primitive that allows engineers or AI assistants (via MCP) to push arbitrary numeric
series into a chart and view it through the same dashboard shell. Every new visualisation
currently requires a full feature cycle (proposal → entity → controller → frontend page).

## Decision

Introduce a new `custom-reports` domain in the NestJS backend, comprising four TypeORM
entities (`CustomReport`, `CustomReportGraph`, `CustomReportDataPoint`,
`CustomReportFilter`) backed by a single TypeORM migration. Expose full CRUD over a
REST API under `/api/custom-reports/*` and surface equivalent tools in the MCP server.
Render the reports through two new Next.js App Router routes (`/reports` and
`/reports/[slug]`) using existing Tailwind v4 design language and Recharts.

Filters are **declarative metadata** applied client-side over the `dimensions` JSONB map
on each data point — no server-side query DSL at v1.

Append operations (`POST .../data-points`) are true `INSERT`s; replace (`PUT`) truncates
then re-inserts. Batch cap is 1 000 points per request; soft per-graph cap is 100 000
points. No application-layer auth (ADR 0020); protected by CloudFront WAF IP allowlist
(ADR 0034).

## Consequences

- **Positive:** Ad-hoc reporting is possible via API/MCP in minutes without a full
  feature cycle. AI assistants can push computed series directly into the dashboard.
  All custom views share the existing design language.
- **Positive:** Separate tables make concurrent appends safe without advisory locks;
  cascade deletes keep cleanup trivial.
- **Neutral:** Client-side filtering limits filter performance to the volume returned by
  the API. Acceptable at the expected scale (hundreds–low thousands of points per graph).
  A server-side DSL can be added if workloads grow.
- **Neutral:** `dimensions` keys/values are bounded to 200 chars in DTO validation to
  limit DB row size; this may constrain future high-cardinality dimension use cases.
- **Negative:** Unlimited text insertion via `dimensions` map is a new (minor) internal
  attack surface. Mitigated by WAF allowlist, DTO length bounds, and React text escaping.
