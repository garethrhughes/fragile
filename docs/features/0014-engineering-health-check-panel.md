# 0014 — Engineering Health Check Panel

**Date:** 2026-07-28
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0071-engineering-health-check-panel.md

## Summary

A weekly engineering **Health Check** panel that renders **above** the existing Pulse
report on the same `/all-items` page. It surfaces two dimensions per board/team —
**Stability** and **Roadmap Delivery** — reusing the Pulse per-board scores, but wrapped
with the context the raw scores lack: volume figures, a rolling 4-week trend, and an
org-level RAG distribution (not a single averaged number). It renders **only for
completed weeks** — never for the current in-progress week.

## Background / Motivation

Engineering leadership needs a weekly health check for **stability** (did teams do what
they planned?) and **roadmap delivery** (was completed output planned work?) suitable for
exec reporting.

The existing Pulse report already computes per-board `stabilityScore` and
`roadmapAlignmentScore`, but as isolated single-week ratios they are easy to misread:

- A single-week ratio is noisy — one late Jira transition can swing it.
- A percentage with no volume context is misleading (100% of 1 item ≠ a good week).
- The org-wide `overallScore` is a mean of ratios where empty/quiet boards contribute
  100, so a quiet week can look "healthier" than a busy one.
- Scrum and Kanban stability mean different things and must not be averaged together.

The Health Check panel keeps the raw signal but presents it responsibly: trend over a
rolling window, volume beside every score, support shown as context (never a penalty),
and an org view expressed as a **distribution** (RAG band counts) rather than one number
that invites gaming or cross-team ranking.

Showing it only for **completed weeks** avoids presenting a half-formed in-progress week
as an exec health signal.

## Scope

**In scope**

- Extend `GET /api/all-items` response with an optional `healthCheck` section, populated
  **only when the selected week is a completed (non-current) week**.
- Per-board Health Check entry containing:
  - Stability score + volume context (Scrum: committed / added / completed; Kanban:
    pulled-in / completed) + RAG band.
  - Roadmap Delivery score + `X of Y completed on-roadmap` + support count as context +
    RAG band.
  - A rolling **4-week trend** (selected week + prior 3) of both scores, computed
    on-the-fly by reusing the existing per-board calculation.
- Org-level **distribution** summary: counts of boards in each RAG band (healthy / watch /
  at-risk) for both stability and roadmap delivery. No single averaged org score.
- RAG banding: **≥ 85% healthy, 70–<85% watch, < 70% at-risk** (shared banding function).
- Frontend Health Check panel rendered **above** the Pulse report on `/all-items`,
  visible only for completed weeks (hidden on the current week).
- Scrum and Kanban stability labelled distinctly; never summed or averaged across board
  types.

**Out of scope**

- Any change to the existing Pulse counts, scores, or `overallScore`.
- Persisting weekly snapshots (trend is computed on-the-fly — no new entity/table).
- A separate endpoint (data is delivered on the existing `all-items` response).
- Configurable RAG thresholds (fixed for v1; may become board/global config later).
- Changing the "current week" definition — reuses the page's existing
  `isCurrentWeek` gate.

## Acceptance Criteria

- Given a **completed** week is selected, when `/all-items` loads, then a Health Check
  panel renders **above** the Pulse report.
- Given the **current (in-progress)** week is selected, when the page loads, then the
  Health Check panel is **hidden** and the Pulse report renders unchanged.
- Given a board, when the Health Check renders, then Stability shows the score plus volume
  context (Scrum: committed/added/completed; Kanban: pulled-in/completed) and a RAG band.
- Given a board, when the Health Check renders, then Roadmap Delivery shows the alignment
  score plus `X of Y completed on-roadmap`, with support count shown as context (not
  folded into the score).
- Given a completed week, each board shows a rolling **4-week trend** for both stability
  and roadmap delivery, computed from existing data (selected week + prior 3 weeks).
- Given multiple boards, the org summary is a **distribution** (e.g. "5 of 6 stable"
  expressed as RAG band counts), not a single averaged score.
- Given both Scrum and Kanban boards, their stability figures are labelled distinctly and
  are never summed or averaged into a single cross-board-type figure.
- RAG banding is applied consistently: ≥ 85% healthy, 70–<85% watch, < 70% at-risk.
- No existing Pulse count, score, or `overallScore` value changes for any week.

## Open Questions

1. Trend performance: computing 4 weeks reuses the per-board calculation ~4×. Is the
   added latency for completed-week requests acceptable, or should the trend be limited
   to the two headline scores only (it already is)? — to be validated in the proposal.
2. Should roadmap delivery use a RAG band when a board completed nothing that week
   (currently Pulse shows `n/a`)? Proposed: treat `n/a` as excluded from the distribution
   rather than counted as healthy or at-risk.

## Notes

- This extends the bespoke, isolated `all-items` module. Keep the addition self-contained
  and read-only against existing entities — do not modify other services.
- "Completed week" follows the Pulse page's existing behaviour: any week that is not the
  current ISO week (`weekParam !== currentIsoWeek()`), matching how the "next week" button
  and "current week" jump already behave.
- Support burden remains **context only** — consistent with the existing decision to
  exclude it from the overall score so teams are not penalised for support they do not
  control.
