# 0010 — Custom Report Layout Configuration

**Date:** 2026-05-08
**Status:** In Progress
**Source:** Manual
**Related proposal:** docs/proposals/0058-custom-report-layout-configuration.md

## Summary

Activate the unused `layout` field on `CustomReport` to provide structured grid layout
configuration for widgets, including a per-report column count, per-widget width overrides,
and a default full-width treatment for table widgets.

Also fixes a bug in the comma-separated multiselect filter input where typing a comma
is blocked, preventing value entry.

## Background / Motivation

The `layout` field on `CustomReport` has existed since the entity was created but is
completely opaque (`Record<string, unknown> | null`) and ignored by the frontend. The
current `CustomReportView` hardcodes a `lg:grid-cols-2` two-column layout with no way
for report authors to control widget placement. Table widgets in particular benefit from
full-width rendering but are currently constrained to the same 2-column grid as charts
and stats.

The comma-separated free-text input used for `multiselect` filters without known options
currently blocks comma input, making it impossible to enter multiple values.

## Scope

**In scope**
- Define a typed `ReportLayout` schema (TypeScript interface + Zod validation) for the `layout` field.
- `layout.defaultColumns` — controls how many columns widgets flow into per row (default 2).
- `layout.widgets` — optional per-widget overrides keyed by widget ID, supporting `colSpan` (width in columns).
- Table widgets (`kind === 'table'`) default to full-width (`colSpan` equal to total column count) unless explicitly overridden.
- Update `CustomReportView` to read and apply the layout configuration.
- Fix the comma-separated multiselect filter input so commas are accepted and values are parsed on blur/submit.
- Update backend DTO to validate the `layout` field against the typed schema (Zod).
- No new API endpoints — `layout` is already persisted via `PATCH /api/custom-reports/:slug`.
- No schema migration needed — `layout` is already a JSONB column.

**Out of scope**
- Drag-and-drop widget reordering UI.
- A visual layout editor / builder UI.
- Row-level or explicit `gridRow` placement (only column span is in scope).
- Changes to data point ingestion or filter persistence.

## Acceptance Criteria

- Given a report with `layout.defaultColumns = 3`, when the report page renders, then widgets flow into a 3-column grid.
- Given a widget with a `layout.widgets[id].colSpan = 2` override in a 3-column grid, then that widget spans 2 columns.
- Given a `table` widget with no layout override, when rendered in any column count, then it spans the full row width by default.
- Given a `table` widget with an explicit `colSpan` override, then that override takes precedence over the full-width default.
- Given a report with no `layout` field (null), when rendered, then the existing 2-column behaviour is preserved.
- Given the comma-separated multiselect free-text input, when the user types a comma, then the character is accepted (not blocked).
- Given the comma-separated multiselect free-text input, when the user blurs or submits, then the value is split on commas and trimmed into individual filter values.
- Given the layout schema is invalid (e.g. `defaultColumns` is a string), when the PATCH endpoint receives it, then a 400 validation error is returned.

## Open Questions

None.

## Notes

- No TypeORM migration is required — `layout` is already `JSONB` on `custom_reports`.
- The typed schema should be defined once and shared between backend (Zod DTO validation) and frontend (TypeScript interface). Given the monorepo structure, the canonical interface lives in `frontend/src/lib/api.ts` (mirroring the backend shape) and the Zod schema lives in the backend DTO.
- `defaultColumns` should be constrained to 1–6 to keep layouts sensible.
- `colSpan` per widget should be constrained to 1–`defaultColumns` (validated at runtime; backend validates the shape, frontend clamps at render time).
