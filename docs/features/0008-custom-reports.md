# 0008 — Custom Reports

**Date:** 2026-05-08
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0056-custom-reports.md

## Summary

Provide a generic "custom reports" capability so that arbitrary reports can be created,
populated with data points, and rendered with multiple graphs and configurable filters —
all driven via the REST API and the companion MCP server. Reports are first-class
internal-only resources that can be created, appended to, updated, and deleted.

## Background / Motivation

The dashboard today exposes a fixed set of opinionated reports (DORA, planning accuracy,
roadmap, sprint report, etc.). Engineers and adjacent tooling (scripts, MCP-driven AI
assistants) frequently want to surface ad-hoc views of data — small experiments, one-off
investigations, or new metrics — without having to build a bespoke module, controller,
schema, and frontend page for each one.

A generic, schemaless-but-typed "custom report" primitive lets us:
- ship new visualisations in minutes via API/MCP rather than days via a full feature cycle
- let AI assistants (via MCP) push computed series straight into a dashboard the user can
  open in the browser
- consolidate one-off reporting in the same UI as our first-class reports, using the
  existing design language (cards, headers, charts)

## Scope

**In scope**
- Custom reports as a new domain entity: `CustomReport` (id, slug, title, description,
  configuration, timestamps).
- Multiple "graphs" per report (e.g. line, bar, area), each with its own data series and
  display config.
- Configurable filters declared on the report (filter definitions) and applied client-side
  to the rendered graphs.
- Data points appended to a graph via API — additive updates (no destruction of existing
  points unless explicitly requested).
- Full CRUD via REST under `/api/custom-reports` and equivalent MCP tools in `apps/mcp/`.
- Frontend route `/reports/[slug]` that renders the report using the existing design
  language (Tailwind v4 + Recharts).
- A reports index page listing all custom reports.

**Out of scope**
- Per-user authentication, ownership, or sharing semantics (internal tool, ADR 0020).
- Joining custom-report data with live Jira data via server-side queries.
- Scheduled/automated data ingestion (out of band — clients push data).
- Versioning / history of report configuration changes.
- Export (CSV/PNG) — can be added later.
- Server-side filter evaluation (filters are applied in the UI from declared definitions).

## Acceptance Criteria

- Given an API client, when it `POST`s to `/api/custom-reports` with a title and slug,
  then a new report is created and returned with an `id`, `slug`, and timestamps.
- Given a report exists, when an API client `POST`s a graph definition to that report,
  then the graph is added to the report's configuration and returned.
- Given a report has a graph, when an API client `POST`s data points to that graph,
  then those data points are appended without overwriting existing points.
- Given a report exists, when its slug URL is loaded in the frontend, then the report
  page renders all configured graphs from the stored data using the existing design
  language.
- Given a report has filter definitions, when the user changes a filter in the UI,
  then the rendered graphs update to reflect the filtered data.
- Given a report exists, when an API client `DELETE`s it, then the report and all
  associated graphs and data points are removed.
- Given the MCP server is connected, when MCP tool calls are made for create/read/
  update/delete on reports, graphs, and data points, then they behave identically to
  the REST API.
- Given an existing report and graph, when an API client appends new data points,
  then the existing points remain intact and the new points are visible on next render.

## Open Questions

- Should the data-point payload accept arbitrary key/value dimensions (for filtering),
  or only `{x, y, series}`? *(Architect to propose; leaning towards typed `x`, `y`,
  optional `series`, plus an open `dimensions` map used by filters.)*
- Should graph types be a closed enum (`line | bar | area`) or open string at v1?
  *(Closed enum at v1 — easier to render and validate.)*
- Should filters be evaluated server-side (querying the data points) or client-side
  (returned-then-filtered)? *(Client-side at v1 for simplicity; revisit if data
  volumes grow.)*
- Bulk data-point ingestion limits — what's a sensible max per request? *(Architect
  to set; suggest 1000 points per call, advisory only.)*
- Should we support replacing a graph's full data set in a single call, or only
  append? *(Both — `POST` appends, `PUT` replaces the series.)*

## Notes

- Internal tool — no application-level auth (ADR 0020). Access controlled by CloudFront
  WAF IP allowlist (ADR 0034). The architect must consider this when shaping the API
  surface and MCP tool boundary, but no per-request auth is required.
- Backend conventions: thin controller, service-layer logic, TypeORM entities, TypeORM
  migration for schema, `class-validator` DTOs validated by global `ValidationPipe`.
- Frontend conventions: API access only via `frontend/src/lib/api.ts`; Zustand for any
  view state; Recharts for graphs; Tailwind v4 CSS-first styling; full strict TS.
- MCP conventions: tool definitions live in `apps/mcp/`; should call the backend HTTP
  API — do not duplicate business logic in the MCP server.
- Data class is internal — no PII concerns — but the architect should still ensure the
  API rejects oversized payloads and that DB indexes support the expected access
  pattern (lookup by slug, list points by graph).
