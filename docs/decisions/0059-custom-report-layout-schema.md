# 0059 — Custom Report Layout Schema

**Date:** 2026-05-08
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0058-custom-report-layout-configuration.md

## Context

The `layout` field on `CustomReport` has existed as an opaque `Record<string, unknown> | null`
JSONB column since the custom reports feature was introduced. No schema was enforced, and the
frontend ignored the field entirely. Report authors had no mechanism to control the widget
grid layout — column count and per-widget widths were hardcoded in `CustomReportView`. A
typed, validated schema was needed that could be stored in the existing JSONB column without
a database migration.

## Options Considered

### Option A — Typed `ReportLayout` schema with Zod validation and static lookup maps
- **Summary:** Define `ReportLayout` as `{ defaultColumns?: 1–6, widgets?: Record<uuid, { colSpan?: 1–6 }> }`, validate on the backend with a custom class-validator decorator delegating to Zod, and apply in the frontend via pure resolver functions with static Tailwind class lookup maps.
- **Pros:** No migration required; strongly typed end-to-end; Zod schema is the single source of truth for shape validation; static Tailwind maps prevent class-purging in production builds; pure resolver functions are trivially testable.
- **Cons:** `colSpan` max of 6 is a convention, not enforced by the grid itself — exceeding column count is clamped at render time.

### Option B — New `WidgetLayout` column on `custom_report_widgets`
- **Summary:** Add a `colSpan` integer column directly to the `custom_report_widgets` table and a `defaultColumns` integer to `custom_reports`.
- **Pros:** Relational — queryable, indexable, individually updatable.
- **Cons:** Requires a migration touching two tables; layout and data are conceptually different concerns; the existing `layout` JSONB field already provides the correct home.

### Option C — String enum presets (`"two-column"`, `"dashboard"`)
- **Summary:** A small enum of named layout templates instead of a numeric + per-widget API.
- **Pros:** Simplest possible API.
- **Cons:** Cannot express mixed layouts (e.g. one full-width table followed by a two-column chart pair); inflexible for future extension.

## Decision

> We will use a typed `ReportLayout` schema — `{ defaultColumns?: 1–6, widgets?: Record<string, { colSpan?: 1–6 }> }` — stored in the existing JSONB `layout` column on `custom_reports`, validated on the backend with a Zod-backed class-validator decorator, and applied in the frontend via pure resolver functions referencing static Tailwind class maps.

## Rationale

Option A avoids a schema migration while delivering a fully typed, validated, and testable
solution. The existing `layout` JSONB column was explicitly designed as a free-form
persistence slot for this purpose. Static Tailwind class lookup maps (rather than
dynamically constructed class strings) are necessary because Tailwind v4's CSS-first scanner
purges classes it cannot statically detect — dynamic template literals like `` `lg:grid-cols-${n}` ``
would produce empty styles in production builds.

Table widgets default to full-width (`colSpan === defaultColumns`) because dense tabular
data consistently benefits from the full row width, and a sensible default reduces the
configuration burden for report authors.

## Consequences

- **Positive:** No migration; typed end-to-end; pure functions are unit-testable in isolation; table-full-width default is a good experience out of the box.
- **Negative / trade-offs:** `colSpan` is clamped at render time — an invalid stored value (e.g. `colSpan: 10` in a 3-column grid) silently maps to the max rather than erroring. The backend validator enforces `colSpan: 1–6` on write, which bounds the stored value to a reasonable range.
- **Risks:** If `defaultColumns` is raised above 6 in future, the static Tailwind lookup maps and the Zod schema must both be updated. This is a known coupling point.

## Related Decisions

- docs/decisions/0057-custom-reports.md — introduced the `layout` JSONB column on `custom_reports`
- docs/decisions/0058-custom-report-widget-rename-and-new-kinds.md — established the widget kind taxonomy used by the full-width table default
