# 0070 — Healthcheck single-denominator three-score model (replaces Pulse)

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Architect Agent
**Proposal:** docs/proposals/0076-healthcheck-report.md

## Context

The "Pulse" report (`all-items` module, `/all-items`, `get_pulse_report`) plus its bolted-on
"Health Check" panel (ADR 0065/0067) grew a 1126-line service that mixes several denominators
(committed∪added unions, a separate roadmap-alignment denominator, kanban board-entry sets)
and renders a CSS-bar sparkline rather than a chart. The requester asked to rethink it from
the ground up around a single, honest denominator — the work the team actually started in a
given week — with three comparable percentage scores.

## Options Considered

### Option A — Rebuild around one denominator; full replacement of Pulse
- **Summary:** New `healthcheck` module; per board/week, `D` = tickets whose first-ever start
  transition fell in the week; three scores `= (100/|D|) * numerator`.
- **Pros:** One base for all three scores; directly comparable; removes accreted complexity.
- **Cons:** Breaking API change; larger diff (module + page + MCP removal).

### Option B — Rename `all-items` in place, keep route/MCP name
- **Summary:** Surgically rewrite the existing service.
- **Pros:** Least churn.
- **Cons:** Retains mixed-denominator baggage; contradicts requester's "get rid of Pulse".

## Decision

We will replace Pulse entirely with a new `healthcheck` feature. For a selected ISO-week, per
board, the denominator `D` is the set of non-Epic/non-subtask issues (ADR 0018) whose
**first-ever** transition into a start status falls in the week (scrum: `inProgressStatusNames`;
kanban: `boardEntryStatuses`). Three scores are each `(100/|D|) * numerator`, or `null` (N/A)
when `|D| = 0`: **Stability** (scrum only), **Roadmap** (scrum only), **Support** (all boards).
No blended overall score. Live-computed, no persistence, URL-param driven.

## Rationale

A single denominator makes the three scores mutually comparable and easy to reason about,
which the old multi-denominator Pulse was not. Full replacement was chosen over an in-place
rename because the requester explicitly asked to remove Pulse and the mixed-denominator model
could not be cleanly reshaped into the new one.

## Consequences

- **Positive:** Simple, comparable metrics; single scan per board; clearer trend.
- **Negative / trade-offs:** Breaking change to `/api/all-items` (internal-only app, ADR 0020);
  8-week trend recomputes live per request.
- **Risks:** Recompute cost if boards grow large — mitigated by bulk queries (no N+1). Revisit
  with a persisted snapshot entity if latency becomes an issue.

## Related Decisions

- Supersedes the Pulse-specific parts of ADR 0065 (Health Check panel) and ADR 0067 (org scores).
- Related: ADR 0018 (Epics/subtasks excluded), ADR 0002 (data cached in Postgres), ADR 0049
  (sprint membership), ADR 0044/0055 (roadmap links), ADR 0045/0047/0061 (support).
- Followed by ADR 0071, 0072, 0073 (this change set).
