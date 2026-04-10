# 0005 — Kanban Boards Excluded from Planning Accuracy Report

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Project setup team
**Proposal:** N/A

## Context

The Planning Accuracy report measures how closely a team delivered on their sprint
commitment — comparing story points committed at sprint start to points actually
completed. This calculation is fundamentally sprint-based: it requires a defined start
date, a committed backlog snapshot, and a fixed end date. Kanban boards (such as the
PLAT board) operate as a continuous flow with no sprint cadence, so the concept of
"commitment" and "planning accuracy" does not apply to them. Attempting to calculate
planning accuracy for a Kanban board would either produce meaningless results or require
artificial sprint-like constructs that misrepresent how the team works.

## Options Considered

### Option A — Return HTTP 400 for planning accuracy on Kanban boards; show clear UI message
- **Summary:** The API returns a structured 400 error when planning accuracy is
  requested for a Kanban board; the frontend renders an explanatory message
- **Pros:**
  - Prevents nonsensical metrics from being displayed
  - Clear, honest communication to users about why the report is unavailable
  - No risk of users acting on meaningless data
  - Simple to implement — board type is already stored in BoardConfig
- **Cons:**
  - Users must understand the distinction between Scrum and Kanban boards
  - A Kanban board user landing on the report gets an error rather than empty data

### Option B — Show empty report with an explanatory banner
- **Summary:** Return an empty data set with a UI warning rather than an API error
- **Pros:**
  - Softer user experience — no error state
- **Cons:**
  - Empty charts with a banner can be confused with "no data yet" rather than "not applicable"
  - 200 response with empty data is semantically misleading for an unsupported operation

### Option C — Calculate a pseudo-planning-accuracy using throughput data
- **Summary:** Adapt the metric for Kanban using weekly throughput as a proxy for commitment
- **Pros:**
  - Provides some metric for all boards
- **Cons:**
  - Throughput is not a planning commitment; the resulting number would be misleading
  - Adds implementation complexity to support a semantically incorrect metric
  - Conflates two different engineering practices

## Decision

> We will return HTTP 400 with a descriptive error body when planning accuracy is
> requested for a Kanban board, and the frontend will render a clear explanatory
> message in place of the report.

## Rationale

Planning accuracy is undefined for Kanban boards; displaying a 400 is semantically
correct and prevents users from drawing false conclusions. Option B risks being
misread as a data-availability problem rather than a concept inapplicability. Option C
would require inventing a metric that doesn't map to any recognised engineering
practice. The board type is already tracked in BoardConfig (ADR-0003), so detecting
Kanban boards adds no additional data requirements.

## Consequences

- **Positive:** Users are never shown meaningless planning accuracy numbers for Kanban
  boards; the codebase has no dead code paths trying to fabricate sprint data for
  flow-based boards
- **Negative / trade-offs:** Kanban board users see an error/message on the planning
  accuracy page rather than a report; this may cause initial confusion
- **Risks:** If a board switches from Kanban to Scrum (or vice versa) without updating
  BoardConfig, the wrong behaviour will be applied; board type should be validated
  during sync

## Related Decisions

- [ADR-0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) — Board type
  (Scrum vs Kanban) is stored in `board_configs` and used to enforce this exclusion
- [ADR-0006](0006-sprint-membership-reconstructed-from-changelog.md) — Sprint
  membership reconstruction is only performed for Scrum boards
