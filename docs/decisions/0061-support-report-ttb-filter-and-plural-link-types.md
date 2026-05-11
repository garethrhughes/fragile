# 0061 — Support Report: TTB Filter and Plural Link Types

**Date:** 2026-05-12
**Status:** Accepted
**Deciders:** Architect Agent
**Proposal:** docs/proposals/0060-support-report-ttb-filter-and-plural-link-types.md

## Context

The support report classifies issues as support work via three mechanisms: epic match,
label match, and issue link match. The link match used a single `supportLinkType` varchar
field on `BoardConfig`, limiting boards to one link type name. Teams may use multiple link
types to connect issues to the triage board. Users also want a filter to narrow the support
report to only issues that are linked to the triage board (TTB), without changing the
total-issues denominator.

## Options Considered

### Option A — Server-side `matchReason` filter; migrate `supportLinkType` to array

Add an optional `matchReason` query parameter to both support endpoints. Apply the filter
after classification so `totalIssues` is unchanged but `supportIssues`/`tickets` reflect
the filtered set. Migrate the entity column from varchar to simple-json array.

- **Pros:** Summary stats are self-consistent; API is self-describing; generic enough to support future `epic`/`label` filters
- **Cons:** Requires a migration; slight increase in API surface

### Option B — Client-side filter only; keep singular field

Filter tickets in the browser; leave `supportLinkType` as-is.

- **Pros:** No migration; no API change
- **Cons:** Summary percentile stats (p50, p95, supportPercentage) in the summary response would not reflect the filter, requiring the frontend to recompute them locally

## Decision

> Migrate `supportLinkType` (varchar, nullable) to `supportLinkTypes` (simple-json string array, default `[]`) and add a server-side `matchReason` optional query parameter to both `/api/support` and `/api/support/summary`.

## Rationale

Server-side filtering keeps the response self-consistent — `supportIssues`, `supportPercentage`,
`p50Days`, and `p95Days` all reflect the filtered subset without duplicating percentile logic in
the frontend. The generic `matchReason` parameter is a small extension that future filters can
reuse. A clean schema migration is safe for an internal tool with no external API consumers.

## Consequences

- **Positive:** Boards can configure multiple link types for support detection; users can scope the report to TTB-linked issues only; summary stats stay accurate under filtering
- **Negative / trade-offs:** A TypeORM migration is required; all callers that read `supportLinkType` directly must be updated
- **Risks:** Boards with an existing `supportLinkType` value must have it preserved by the migration; the `down()` migration loses the array if it contains more than one element (acceptable — single-element usage was the only prior use)

## Related Decisions

- [ADR 0045](0045-support-ticket-report.md) — Original support ticket report design, introduced `supportLinkType` and `triageBoardKey`
