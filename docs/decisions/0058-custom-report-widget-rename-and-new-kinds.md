# 0058 — Custom Report Widget Rename and New Widget Kinds (Table, Stat)

**Date:** 2026-05-08
**Status:** Accepted
**Proposal:** docs/proposals/0057-custom-report-table-and-stat-graphs.md
**Supersedes:** —
**Superseded by:** —

## Context

Proposal 0056 introduced custom reports with three chart kinds (`line`, `bar`, `area`)
modelled as "graphs" (`CustomReportGraph` entity, `/graphs` routes, `add_custom_report_graph`
MCP tool). Once table and stat callout layouts were required, the `graph` name became
semantically incorrect. The feature was newly deployed with no external consumers beyond the
dashboard UI and the MCP server, making a breaking rename safe.

## Decision

1. Rename `graph` → `widget` throughout the full stack: DB table
   (`custom_report_graphs` → `custom_report_widgets`), TypeORM entity, routes
   (`/graphs` → `/widgets`), DTOs, MCP tools, frontend components, Zustand store keys,
   and the API response field (`customReport.graphs` → `customReport.widgets`).
2. Extend `WidgetKind` to `'line' | 'bar' | 'area' | 'table' | 'stat'`.
3. Add a nullable `columns` JSONB column to `custom_report_widgets` for `table` widget
   column definitions (key, label, type, sortable).
4. Add nullable `stat_unit`, `stat_subtitle`, `stat_band` columns for `stat` widgets.
5. Surface `jiraBaseUrl` from `ConfigService` on `GET /api/custom-reports/:slug` to
   support `issue`-type column links without baking the Jira URL into the Docker image.
6. Old `/graphs` routes return 404 post-migration; no backwards-compatibility shim.

## Consequences

- **API breaking change** — `/graphs` path and `graphs` response field removed. Acceptable
  because the feature has no external consumers at time of change.
- **One migration** — renames the table and adds three nullable columns; fully reversible.
- **Two new frontend components** — `TableWidget` and `StatWidget`; new shared `StatusBadge`.
- **MCP tools renamed** — `add_custom_report_graph` → `add_custom_report_widget` etc.
- `stat` + `columns` together returns `400` — enforced at the DTO validation layer.
