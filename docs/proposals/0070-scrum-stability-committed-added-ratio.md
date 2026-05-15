# 0070 — Scrum Stability: Use Sprint-Lifetime Committed/Added Ratio

**Date:** 2026-05-15
**Status:** Accepted
**Author:** Architect Agent
**Related ADRs:** ADR 0062 (Kanban stability — throughput balance)

## Problem Statement

The current scrum stability formula in the pulse report is:

```
stability = (1 - addedMidSprintCountThisWeek / totalUnionItems) * 100
```

This produces misleadingly high scores because:

1. **Denominator inflated** — `totalUnionItems` is the union of all issues across every
   sprint overlapping the week. A 2-week sprint touching W19 and W20 contributes its
   full item set to both weeks; when two sprints overlap, their items are merged.

2. **Numerator deflated** — `addedMidSprintCountThisWeek` only counts additions whose
   Sprint-field changelog falls within the selected week window. An issue added in W19
   does not count against W20, even though the sprint is still active and the scope
   creep already happened.

Real example: BPT Sprint 6 had 40 committed + 5 added = 89% stability. But the current
formula showed 91% (W19) and 100% (W20) by diluting across the full union.

## Proposed Solution

Replace the formula with:

```
stability = sum(committed) / sum(committed + added) * 100
```

Where `committed` and `added` are the sprint-lifetime values already computed by
`SprintMembershipService.reconstructMany()` — the same source of truth used by the
planning accuracy report. When multiple sprints overlap a week, pool their committed and
added counts before dividing.

This is mathematically equivalent to a weighted average of per-sprint stability scores
(weighted by total items per sprint).

### Changes required

1. **`all-items.service.ts` — `calculateHealthScore()`**: for scrum boards, accept
   `totalCommitted` and `totalAdded` from the sprint membership reconstruction (already
   available in `processBoardForWeek`) and compute
   `Math.round(totalCommitted / (totalCommitted + totalAdded) * 100)`.

2. **`all-items.service.ts` — `processBoardForWeek()`**: accumulate `committedCount` and
   `addedCount` from the membership map while building the working set (the data is
   already iterated at that point).

3. **Frontend tooltip** in `page.tsx`: update the scrum stability tooltip to reflect the
   new semantics.

### Edge case: no overlapping sprints with members

When all overlapping sprints have 0 members (e.g. a brand-new sprint just started with
no committed items yet), return `stabilityScore = 100` (no scope creep has occurred).

## Alternatives Considered

### Week-scoped additions only (current approach)

Only count additions whose changelog falls in the selected week.

**Ruled out:** Deflates additions and inflates the denominator, hiding real scope creep.

### Per-sprint stability without weighting

Show the stability of the "primary" sprint (most overlap days) only.

**Ruled out:** Breaks during sprint transitions; loses visibility into the outgoing sprint.

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Backend | Formula change in `calculateHealthScore` | No schema/API shape changes |
| Frontend | Tooltip text update | |
| Tests | Update existing stability tests | |
| Infrastructure | None | |
| Observability | None | |
| Security / Compliance | None | |

## Acceptance Criteria

- [ ] Scrum stability uses `sum(committed) / sum(committed + added) * 100` across all
      overlapping sprints for the selected week
- [ ] When committed + added = 0 (no sprint members), stability = 100
- [ ] Kanban stability formula unchanged (ADR 0062 throughput balance)
- [ ] Planning accuracy committed/added numbers match pulse stability inputs exactly
      (same `SprintMembershipService` data)
- [ ] Frontend tooltip updated to describe the new formula
- [ ] Existing scrum stability tests updated to match new expected values
