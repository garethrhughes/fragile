# 0019 — Healthcheck Report (replaces Pulse)

**Date:** 2026-08-03
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0076-healthcheck-report.md

## Summary

Replace the existing "Pulse" report (the `all-items` backend module plus the bolted-on
Health Check panel) entirely with a new **Healthcheck** feature. For a selected ISO-week
period it computes three per-board percentage scores from a single shared denominator —
the set of tickets whose **first-ever In-Progress transition** occurred within that week —
and renders current values plus an 8-week Recharts trend.

## Background / Motivation

The current Pulse report (`all-items` module) grew organically: it mixes multiple
denominators (committed/added unions, a separate roadmap-alignment denominator, kanban
board-entry sets), layers a separate "Health Check" panel on top (proposal 0071/0073,
ADR 0065/0067), and uses a bespoke CSS-bar sparkline rather than a real chart. The scoring
model is hard to reason about and inconsistent between the panel and the underlying report.

The desired model is far simpler and more honest: **one denominator** — "how much work did
the team actually start this week" — and three numerators expressed as a percentage of that
same base:

- **Stability** — of the work we started, how much was planned?
- **Roadmap** — of the work we started, how much is on the roadmap?
- **Support** — of the work we started, how much was reactive support?

This gives three directly comparable percentages against an identical base, removes the
blended/obscured scoring, and lets the trend graph plot all three cleanly.

## Scope

**In scope**

- New backend `healthcheck` module computing the three scores per board for a selected
  ISO-week, plus an 8-week trend series per board.
- Single shared denominator: tickets whose **first-ever** in-progress transition fell in
  the week (scrum: first in-progress status transition; kanban: first board-entry transition).
- Stability numerator (scrum only): of the denominator tickets, those that were **planned** —
  committed at the start of, or carried over into, the sprint that was active on that board
  **at the moment the ticket moved to In Progress**.
- Roadmap numerator (scrum only): of the denominator tickets, those classified on-roadmap via
  the full `classifyRoadmapStatus` (in-scope | linked; epic + direct-link — ADR 0044/0055).
- Support numerator (all boards): of the denominator tickets, those classified as support via
  the authoritative `support.service` signals (epic OR label OR TTB link — ADR 0045/0047/0061).
- Kanban (PLAT): Stability = N/A, Roadmap = N/A; Support computes normally.
- New frontend `/healthcheck` page with week navigation (`←`/`→`/`Latest`, default = last
  completed week) and a Recharts `LineChart` trend (3 lines, `connectNulls={false}`, 8 weeks).
- New MCP tool `get_healthcheck_report`.
- **Full removal** of the old feature: `all-items` backend module (controller/service/DTOs),
  `/all-items` page + route + sidebar entry, `all-items`/`healthCheck` api.ts wrappers and
  types, `HealthCheckPanel` component + `health-check-bands`, and the `get_pulse_report`
  MCP tool.

**Out of scope**

- Any blended/overall "healthcheck score" per board or org-wide — three separate scores only.
- Persisting Healthcheck results to a new entity — computed live per request (as Pulse was).
- Changes to the separate `sprint-report` feature (its Recharts `TrendChart` is only the
  visual reference we are mirroring).
- Changes to `SprintMembershipService`, roadmap classification, or support classification
  logic — we reuse them as-is.

## Acceptance Criteria

- Given a selected ISO-week, when I open `/healthcheck`, then each configured board shows a
  Stability, Roadmap, and Support percentage for that week.
- Given a scrum board, when computing any score, then the denominator is the count of tickets
  whose **first-ever** in-progress transition (into an `inProgressStatusNames` status) falls
  within `[weekStart, weekEnd]`.
- Given a kanban board (PLAT), when computing Support, then the denominator is the count of
  tickets whose **first** board-entry transition falls within the week; and Stability and
  Roadmap are returned as **N/A** (null), not 0.
- Given a denominator ticket on a scrum board, when computing Stability, then it counts toward
  the numerator iff — for the sprint active on that board at the ticket's in-progress moment —
  the ticket was committed at that sprint's start (ADR 0049 `committedKeys`) OR carried over
  from the immediately prior closed sprint (ADR 0039).
- Given a denominator ticket, when computing Roadmap, then it counts toward the numerator iff
  `classifyRoadmapStatus` returns `in-scope` or `linked`.
- Given a denominator ticket, when computing Support, then it counts toward the numerator iff
  the authoritative support signals (epic OR label OR TTB link) match.
- Given a denominator of zero for a board/dimension, when scoring, then the score is **N/A**
  (null) and rendered as an empty-state, not 0%.
- Given the trend, when the page loads, then a Recharts `LineChart` plots Stability, Roadmap,
  and Support for the trailing 8 weeks (oldest→newest), with N/A weeks rendered as gaps
  (`connectNulls={false}`).
- Given each score, then `Score = (100 / denominator) * numerator`, i.e. a percentage in
  `[0, 100]`.
- Given the removal, when the change is merged, then the `all-items` module, `/all-items`
  route, `HealthCheckPanel`, and `get_pulse_report` MCP tool no longer exist, and no code
  references them.
- Given the MCP server, when `get_healthcheck_report` is called with a week, then it returns
  the same per-board three-score payload as the API.

## Open Questions

- Band thresholds (RAG colouring) for each of the three scores — reuse `roadmapDeliveryTarget`
  and similar `BoardConfig` targets, or define new Healthcheck bands? To be decided in the
  proposal.
- Whether Support should be visually flagged as "lower is better" (burden) while Stability and
  Roadmap are "higher is better". To be decided in the proposal.

## Notes

- Reuse the canonical ISO-week utilities (`backend/src/lib/iso-week.ts`) and the frontend
  page-local week arithmetic already used by Pulse.
- Reuse `SprintMembershipService` (ADR 0049), `roadmap-classification.ts` /
  `roadmap-link-utils.ts` (ADR 0044/0055), and the `support.service` classification signals
  (ADR 0045/0047/0061) — do not re-implement.
- "Sprint active at the in-progress moment" resolves the week-overlaps-two-sprints case:
  the committed/carry-over check is made against whichever sprint contained the transition
  timestamp on that board.
- No persistence, no Zustand store — live-computed, URL-param driven (matches Pulse).
- Trend requires recomputing the three scores for the trailing 8 weeks per board; design must
  keep this efficient (bulk changelog/membership queries, no N+1) per project rules.
