# ADR 0065 — Pulse Page Density Redesign

**Date:** 2026-05-15
**Status:** Accepted
**Proposal:** 0069-pulse-page-density-redesign.md

## Context

The Pulse page (`/all-items`) stacks per-board data in individual rounded cards, each
with three separate header rows (boardId+health / count metrics / roadmap+stability
subscores). With 6 boards, combined chrome reaches ~1100px — more than a full 1080p
screen — before any issue items are visible. Controls (week picker + filter chips) occupy
a full bordered card (~120px) above the data.

## Decision

Redesign the page layout with three changes, no backend changes required:

1. **Compact toolbar** — collapse week nav + filter chips into a single inline `<div>`
   row beside the page title. Remove the bordered card wrapper.

2. **Totals strip** — replace 7 individual stat tiles with a single `divide-x` strip
   (no individual borders or shadow).

3. **Board table** — replace stacked `BoardCard` components with a single `<table>` where
   each board is one row. Inline expand/collapse reveals the existing `IssueTable`.
   Kanban boards show `—` in the "Added" column; scrum boards show `—` in "In Flight".

## Consequences

- All 6 boards visible simultaneously on a 1280×800 viewport without scrolling.
- ~400–500px saved versus the previous layout.
- No API or data-model changes; no backend changes.
- `IssueTable` component reused unchanged.
