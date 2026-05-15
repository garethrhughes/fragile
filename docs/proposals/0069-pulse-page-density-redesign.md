# 0069 — Pulse Page Density Redesign

**Date:** 2026-05-15
**Status:** Accepted
**Author:** Architect Agent

## Problem Statement

The current Pulse page (`/all-items`) wastes significant vertical space at every level:

1. **Controls section** — the week picker and filter chips each occupy a full labelled
   row inside a rounded card, consuming ~120px of chrome before any data is shown.
2. **Overall score + totals bar** — the 7 stat tiles are individual rounded cards with
   their own borders, padding, and shadow, each 80–90px tall. On a 1280px viewport this
   forces immediate scrolling before any board data is visible.
3. **BoardCard header area** — each board card has three separate full-width rows for
   (a) boardId + health badge, (b) count metrics, and (c) roadmap/stability subscores.
   That is three horizontal rules and ~140px of card height before the issue list appears.
4. **`space-y-4` / `space-y-6` gaps** between every element compound the problem — with
   6 boards each rendered as a card, the page is ~1100px of non-content chrome.

The net result: on a standard 1080p screen, a user viewing 6 boards sees zero issues
without scrolling, and often cannot see more than two boards' summaries at once.

## Proposed Solution

Replace the stacked-card layout with a compact, information-dense design that keeps all
per-board summaries visible without scrolling on a 1080p screen and reduces the controls
to a single toolbar row.

### 1 — Compact toolbar (single row)

Collapse the controls card into a single `<div>` flex row that lives inline with the
page title:

```
Pulse  ←  W20 '26  →  [Current week]    [Added mid-week ×]  [Clear]
```

- No surrounding card border or `p-4` wrapper.
- Week nav + filter chips on the same line, separated by a `|` divider.
- Label text ("Week", "Filter") removed — the controls are self-evident.
- Saves ~100px.

### 2 — Single-row summary strip (not individual tiles)

Replace the 7 individual stat tiles with a single borderless strip:

```
Overall  89   |  Total 47  ·  Completed 14  ·  On roadmap 11  ·  Support 4  ·  TTB 1
```

- One thin `<div>` with `divide-x` separators, no card borders, no shadow.
- Numbers in `font-bold text-base`; labels in `text-xs text-muted`.
- Overall health badge remains pill-shaped but sits inline.
- Saves ~80px.

### 3 — Compact board table (replace BoardCard with table rows)

Replace the per-board stacked cards with a single `<table>` where each board is one row.
The table is always visible; the issue drill-down opens in an inline expandable below
the row (like a `<tr>` + collapsible `<tr>`).

```
Board  Type    Pulled In / Total  In Flight  Completed  Roadmap  Stability  Health  ↓
ACC    scrum          12              —           9         7       83%       91
BPT    scrum           8              —           6         5       88%       88
PLAT   kanban         13             22          13        11       85%       87
...
```

- Column headers match the existing data model exactly.
- Numeric cells are right-aligned; badge cells centred.
- Scrum rows hide the "In Flight" column value (show `—`).
- Kanban rows hide the "Added" column value (show `—`).
- The `↓` expand button on the right opens an inline `<tr>` containing the existing
  `<IssueTable>` component — no change to the issue table itself.
- Health badge colours (green/yellow/red) remain from existing `HealthBadge`.
- Tooltip text on column headers replaces the per-row tooltips on individual metrics.
- Row hover: `hover:bg-interactive-hover-bg`.

This layout saves approximately 80–100px **per board** versus the current stacked cards,
making all 6 boards visible simultaneously on a 1080p screen without scrolling.

### 4 — Reduce `space-y` throughout

- Page root: `space-y-6` → `space-y-3`
- Loading skeletons: `h-32` → `h-8` (table row height)

## Data Model

No backend changes. All data already available in `AllItemsResponse`.

## Alternatives Considered

### Alternative A — Keep cards but reduce padding

Reduce `p-4` → `p-2`, `py-3` → `py-1.5` across all existing card elements.

**Ruled out:** Reduces whitespace but retains the fundamental problem — stacked cards
consume height proportional to the number of boards. With 6 boards the page is still
very tall. Does not solve the root cause.

### Alternative B — Horizontal scroll with fixed-width board cards

Arrange board cards in a horizontal `overflow-x-auto` row.

**Ruled out:** Breaks the issue drill-down pattern (cards need to be tall enough to show
items inline). Also poor for keyboard/screen-reader navigation.

### Alternative C — Collapsible sidebar summary + main area for one board at a time

Show board list in a left panel; click to focus one board's issues.

**Ruled out:** Makes cross-board comparison difficult. The primary use case is a weekly
standup/review where all boards are compared simultaneously.

## Impact Assessment

| Area | Impact | Notes |
|---|---|---|
| Frontend | New layout only | No API or data changes |
| Backend | None | |
| Tests | Update/add Vitest tests for BoardRow, ToolbarRow | |
| Infrastructure | None | |
| Observability | None | |
| Security / Compliance | None | |

## Acceptance Criteria

- [ ] Controls (week nav + filter chips) rendered in a single toolbar row with no
      surrounding card border; saves ≥80px vs current
- [ ] Overall score + totals rendered as a single borderless strip row (no individual
      stat tiles); saves ≥60px vs current
- [ ] All board summaries rendered as rows in a single `<table>` (not stacked cards)
- [ ] Each board row shows: boardId, boardType, pulled-in/total, in-flight (kanban) /
      added (scrum), completed, on-roadmap count, stability %, roadmap %, health score
- [ ] Board row expand/collapse reveals the existing `IssueTable` component inline
- [ ] Kanban boards show `—` in the "Added" column; scrum boards show `—` in "In Flight"
- [ ] All 6 boards visible simultaneously on a 1280×800 viewport without scrolling
- [ ] No regressions in existing filter, week-nav, or tooltip behaviour
- [ ] TypeScript strict passes; no `any` casts introduced
</content>
</invoke>