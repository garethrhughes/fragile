# 0062 — Kanban Stability Score: Throughput Balance

**Date:** 2026-05-15
**Status:** Accepted
**Deciders:** Architect Agent
**Proposal:** [0064 — Kanban Stability Score: Throughput Balance](../proposals/0064-kanban-stability-score-throughput-balance.md)

## Context

The pulse report (All Items Weekly Report) calculates a `stabilityScore` for every board.
The existing formula `(1 - addedMidSprintCount / totalItems) * 100` works for scrum boards
but produces a permanent score of **0%** for kanban boards, because every item in the kanban
working set is classified as `kanbanAdd = true` by design (the working set is bounded to
issues whose board-entry date falls within the selected week).

This meant kanban teams received a misleading health score that bore no relation to their
actual behaviour and that could not be improved by any change in their working practices.

## Decision

For kanban boards, replace the disruption-ratio formula with a **throughput balance** formula:

```
kanbanStabilityScore = min(completedCount / totalItems, 1.0) * 100
```

For scrum boards, the existing formula is unchanged:

```
scrumStabilityScore = (1 - addedMidSprintCount / totalItems) * 100
```

The `calculateHealthScore` method accepts a `boardType` parameter (`'scrum' | 'kanban'`) and
branches on it to apply the correct formula.

### Throughput balance rationale

A kanban team is "stable" when it completes work at the same rate it pulls work in. A team
that consistently brings in more work than it finishes is accumulating WIP, which degrades
cycle times — the canonical kanban instability signal. The ratio `completed / entered` directly
measures this balance within the weekly window, without requiring sprint commitment boundaries
that kanban teams do not have.

Over-delivery (more completions than entries this week) is capped at 100% — clearing a
backlog is not penalised.

### Edge cases

| Scenario | Result |
|---|---|
| `totalItems === 0` (empty board) | 100% (no signal, assume healthy — unchanged behaviour) |
| `completedCount > totalItems` | 100% (capped via `Math.min`) |
| `completedCount === 0, totalItems > 0` | 0% (nothing finished — genuinely unstable) |

## Consequences

- Kanban boards now produce a meaningful 0–100 stability score that teams can act on
- The `overall` composite score for kanban boards now reflects real team behaviour
- The `stabilityScore` field in the API response is unchanged in type and range (0–100 integer)
- No schema change required — uses existing `completedCount` and `totalItems` from `buildSummary()`
- The JSDoc on `BoardHealthScore.stabilityScore` must document both formulas
- The frontend stability tooltip must display the kanban-specific explanation for kanban boards
