# 0070 — Support Load as a Context Metric; Recharts Trend Sparklines

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0076-support-load-metric-and-health-check-ui.md

## Context

The Health Check classified support work per board and computed a `supportBurdenScore`, but
that score was excluded from the health score and never surfaced as a trended, comparable
metric — so teams had no visibility of reactive/support load. We needed to surface it, decide
how to present it (graded vs context), how to aggregate it at the org level, and separately
improve the panel's hard-to-read bar trends and its visual blend with the Pulse report.

## Options Considered

### Option A — Support Load as a context metric (chosen)
- **Summary:** Per-team `round(support/totalItems×100)` shown as `X% (n of m)` + trend, muted (not RAG); org = mean of team percentages + total count. Excluded from the health/overall score.
- **Pros:** Visibility + trend + cross-team comparison without perverse incentives; consistent with the existing decision to exclude support burden from the health score.
- **Cons:** Not a pass/fail signal — requires reading the trend, not a single band.

### Option B — RAG-graded support load
- **Cons:** Support demand is inbound/not team-controlled; grading incentivises deflecting tickets to look "green".

### Org aggregation — mean of team percentages (chosen) vs weighted Σsupport/ΣtotalItems
- Chose the **simple mean of team percentages** so every team counts equally and the number is consistent with `overallStabilityScore`; the absolute `totalSupportCount` is shown alongside for volume.

### Trend visualisation — Recharts line sparklines (chosen) vs improved CSS bars
- Chose **Recharts line sparklines** (Recharts is already the app's charting lib) for legibility and consistency with DORA/cycle-time charts.

## Decision

We will add **Support Load** to the Health Check as a **context metric, not a graded/RAG
score**: per board `supportLoadScore = round(supportCount / totalItems × 100)` (0 when
`totalItems = 0`), included in the 4-week trend; org `overallSupportLoad` = the simple mean
of the per-team percentages, plus `totalSupportCount`. It is **excluded** from the
overall/health score and all RAG banding. Trend sparklines (stability, roadmap, support
load) are rendered with a shared Recharts `LineChart` component, and the Health Check is
given a distinct section header + divider to separate it from the Pulse report.

## Rationale

Support demand is largely inbound and not team-controlled, so RAG-grading it (Option B) would
create perverse incentives; context-only presentation matches the pre-existing exclusion of
`supportBurdenScore` from the health score. A simple mean of team percentages keeps the org
number consistent with the other org scores and prevents a large team dominating; the total
count preserves volume context. Recharts sparklines reuse the existing charting stack and are
far more legible than the fixed-height bars.

## Consequences

- **Positive:** Teams and leadership can see and trend reactive load and compare across teams,
  without a gameable score. Clearer trends and a cleaner, delineated panel.
- **Negative / trade-offs:** Support Load is informational only — it does not raise an alert on
  its own; readers must interpret the trend/share.
- **Risks:** The metric's accuracy depends on per-board support classification config
  (`supportEpics`/`supportLabels`/`supportLinkTypes`); if unmaintained it partly measures Jira
  hygiene. Validate config per board before treating it as a KPI.

## Related Decisions

- Extends [0065](0065-engineering-health-check-on-the-fly-trend-and-rag-distribution.md) (Health Check) and [0067](0067-health-check-roadmap-targets-and-org-scores.md) (org scores + targets).
- Consistent with the earlier decision to exclude `supportBurdenScore` from the health score.
