# 0009 — Custom Report Table and Stat Graph Kinds

**Date:** 2026-05-08
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0057-custom-report-table-and-stat-graphs.md

## Summary

Extends custom reports with two new graph kinds: `table` (a sortable data grid with typed
columns, matching the sprint view aesthetic) and `stat` (a single metric callout card with
a large primary value, optional unit, optional subtitle, and a band-coloured left border).
Also adds a `link` column type for the table renderer.

## Background / Motivation

The existing custom reports feature supports `line`, `bar`, and `area` chart graphs. Many
useful reports are better expressed as tables (e.g. issue lists, per-team breakdowns) or as
headline stat cards (e.g. a key metric with a performance band). Both patterns already exist
in the first-class dashboard views (sprint view for tables, support/cycle-time pages for stat
cards) but are not available in the generic custom reports primitive. Exposing them here lets
AI assistants and engineers compose richer reports without a full feature cycle per view.

## Scope

**In scope**
- New `table` graph kind with column definitions stored on `CustomReportGraph`
- Column types: `text`, `number`, `status`, `priority`, `issue` (Jira link), `link` (external URL), `icon`
- Sortable column headers (client-side, no network call)
- New `stat` graph kind with `value`, `unit`, `subtitle`, `band`, `bandLabel` fields on `CustomReportGraph`
- Band-coloured left border on stat cards (elite=green, high=blue, medium=amber, low=red, none=grey)
- Schema migration adding `columns` (JSONB) and stat-specific fields to `custom_report_graphs`
- Updated DTOs and API (additive — existing graph kinds unaffected)
- Frontend components: `TableGraph.tsx`, `StatGraph.tsx`
- MCP tools continue to work (no new tools needed — existing `add_custom_report_graph` / `update_custom_report_graph` accept the new kinds and fields)
- Unit tests for new components and column renderer logic

**Out of scope**
- Server-side sorting or pagination of table rows
- Column visibility toggles or column reordering in the UI
- Conditional row formatting / row-level colour rules
- Inline editing of table cells
- CSV export of table data
- New MCP tools (existing tools cover the new kinds via the updated DTOs)

## Acceptance Criteria

- Given a graph with `kind: "table"` and `columns` defined, when the report page renders, then a data table is shown (not a chart) with one column per definition
- Given a table graph, when a column header is clicked, then the table sorts by that column ascending; a second click sorts descending
- Given a column of type `status`, when rendered, then the value displays as a styled status badge matching the sprint view
- Given a column of type `priority`, when rendered, then the value displays as a coloured dot + label
- Given a column of type `issue`, when rendered, then the value is a Jira issue key rendered as an external link (new tab)
- Given a column of type `link`, when rendered, then the value is rendered as an external hyperlink (new tab) using the cell value as the URL and an optional label
- Given a column of type `icon`, when rendered, then an appropriate icon is shown for the value
- Given a column of type `text` or `number`, when rendered, then the raw value is displayed as plain text
- Given a graph with `kind: "stat"`, when rendered, a stat callout card is shown with a large bold primary value, optional unit suffix, optional subtitle, optional band badge, and a left border coloured by band
- Given `kind: "table"` or `kind: "stat"` passed to `POST /api/custom-reports/:slug/graphs`, the endpoint accepts and persists the graph with `201`
- Given an existing `add_custom_report_graph` MCP tool call with `kind: "table"` or `kind: "stat"`, the tool succeeds and the graph is retrievable
- Given the TypeORM migration runs (`npm run migration:run`), the `custom_report_graphs` table gains `columns` (JSONB nullable) and stat fields; `down()` cleanly reverts
- All new frontend components have unit test coverage; all existing tests remain green

## Open Questions

- Should `columns` on a `stat` graph be null/ignored, or should we validate that `stat` graphs must not have columns? Recommendation: ignore — backend validates that `columns` is only meaningful for `table` kind.
- Should the `band` field on a `stat` graph be a free string or constrained to `elite | high | medium | low`? Recommendation: constrained enum — consistent with DORA band vocabulary already in the codebase.

## Notes

- The sprint view issue table (`frontend/src/app/sprint/`) is the reference implementation for column renderers — reuse or extract shared primitives where possible rather than duplicating styling.
- The support page stat cards are the reference for `stat` graph layout and band colouring.
- Column definitions are stored as JSONB on `custom_report_graphs.columns` — no new entity needed.
- The `dimensions` map on `CustomReportDataPoint` is the source of column values for table rows; the `x`, `y`, and `series` fields remain available as addressable column keys.
