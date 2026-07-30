# 0019 — Support Load Metric & Health Check UI Overhaul

**Date:** 2026-07-28
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0076-support-load-metric-and-health-check-ui.md

## Summary

Add a **Support Load** metric to the Pulse Health Check (per-team percentage + count +
4-week trend, plus an org-level percentage), presented as context — not a graded RAG
score. Alongside it, overhaul the Health Check panel UI: replace the crude bar sparklines
with Recharts mini line sparklines, and give the Health Check clear visual separation from
the Pulse report beneath it on `/all-items`.

## Background / Motivation

The Health Check already classifies support work per board (`supportCount`, via
`supportEpics`/`supportLabels`/`supportLinkTypes`) and computes a `supportBurdenScore`, but
that score is deliberately excluded from the health score and is not surfaced as a trended,
comparable metric. Teams and leadership want visibility of **reactive/support load** — how
much of a team's week goes to support, whether it's trending up, and which teams carry a
disproportionate share.

Support load must be shown as **context, not a RAG-graded score**: support demand is largely
inbound (ticket-driven), not team-controlled, so grading it would incentivise deflecting
tickets to look "green". See `docs/pulse-health-check-metrics.md` for the fuller rationale.

Separately, the Health Check panel's trend visualisation (fixed-height bars) is hard to read,
and the panel blends visually into the Pulse report below it. This feature improves both.

## Scope

**In scope**

*Support Load metric:*
- Per board: `supportLoadScore = round(supportCount / totalItems × 100)` (0 when `totalItems = 0`).
- Include the per-week support-load value in each board's existing 4-week `trend` points.
- Org level: `overallSupportLoad = round(mean of each board's supportLoadScore)` — a
  **percentage**, plus the **total support-item count** across boards.
- Frontend: a "Support Load" column per team showing `X% (n of m)` + a mini trend, styled as
  muted **context** (not RAG-coloured), with an explanatory tooltip.
- Header shows the org support-load percentage + total count.
- Support Load is **excluded** from `overall`/health scores and from RAG banding.

*Health Check UI overhaul:*
- Replace the bar-style sparklines (stability/roadmap and the new support-load trend) with
  small **Recharts line sparklines**.
- Give the Health Check panel a clear **section header** (title + subtitle) and strong
  **visual separation** (spacing + divider) from the Pulse report section beneath it.

**Out of scope**

- Changing how support is *classified* (the per-board config stays as-is).
- Making support load a graded/banded score (deliberately context-only).
- A standalone support-load page or historical persistence (uses the existing on-the-fly
  Health Check computation).
- Changes to the underlying stability/roadmap calculations.

## Acceptance Criteria

- Each `HealthCheckBoard` includes `supportLoadScore` = `round(supportCount / totalItems × 100)`; when `totalItems = 0` it is 0.
- Each board's 4-week `trend` points include the support-load value for that week.
- `HealthCheckReport` includes `overallSupportLoad` (a percentage = rounded mean of the boards' `supportLoadScore`) and `totalSupportCount` (sum of support items across boards).
- The Health Check panel renders a **Support Load** column per team as `X% (n of m)` with a mini trend; it is styled as muted context (not RAG-coloured) and has a tooltip explaining it is not part of the health score.
- The panel header shows the org support-load percentage and the total support-item count.
- Support Load does **not** affect `overall`, `overallStabilityScore`, `overallRoadmapScore`, or any RAG distribution.
- Trend sparklines (stability, roadmap, support load) are rendered with Recharts line charts, not fixed-height bars.
- The Health Check section is visually separated from the Pulse report on `/all-items` (distinct section header + divider/spacing).
- New backend tests cover: per-board `supportLoadScore`, the `totalItems = 0` edge case, `overallSupportLoad` (mean of percentages), and `totalSupportCount`.
- New/updated frontend tests cover: the Support Load column rendering (`X% (n of m)`), org support-load display, and that support load is not RAG-coloured.

## Open Questions

None — resolved at intake:
- Org support load = **simple mean of each team's percentage** (consistent with `overallStabilityScore`).
- Per-team denominator = the weekly **working set** (`totalItems`).
- Trend visual = **Recharts line sparklines**.
- Separation = **section headers + divider + spacing**.

## Notes

- The metric's trustworthiness depends on the per-board support classification config
  (`supportEpics`/`supportLabels`/`supportLinkTypes`). If unmaintained, it measures Jira
  hygiene as much as real load — worth validating per board before treating it as a KPI.
- Recharts is already the app's charting library (used on DORA/cycle-time), so no new
  dependency is introduced.
- Reuses the existing on-the-fly Health Check computation and 4-week trend machinery — no
  schema change, no persistence.
