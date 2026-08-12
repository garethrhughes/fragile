# 0085 — Remove the Support "TTB-linked" (matchReason) dashboard filter

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0080-support-unified-periods-remove-ttb-filter.md

## Context

The Support dashboard had a "TTB-linked only" toggle (URL `?matchReason=link`) that, when
on, narrowed the returned support tickets and the `supportIssues` numerator to those
classified via a triage-board issue link (leaving the `totalIssues` denominator unchanged).
This filter was no longer wanted and existed only on the Support report.

## Options Considered

### Option A — Keep the filter
- **Cons:** Unwanted; adds a report-specific dimension the unification effort is removing.

### Option B — Remove the filter but keep classification, Match column, and MCP param
- **Summary:** Delete the UI toggle, the `matchReason` URL param/state, the frontend
  `SupportQueryParams.matchReason` and its wrappers, the backend `SupportQueryDto.matchReason`
  field, and its application in `SupportService`. Keep `classifySupport`/`isTtbSupport`, the
  per-ticket `matchReason` field (Match column), and the MCP support tool's `matchReason`.
- **Pros:** Unifies Support with the other reports; preserves useful classification display
  and the AI-assistant filter.

## Decision

The Support "TTB-linked" dashboard filter is removed: the UI switch, the `matchReason` URL
param/state/fetch-dependency, the frontend `SupportQueryParams.matchReason` field and its
wrapper plumbing, the backend `SupportQueryDto.matchReason` field, and its application in
`SupportService.getSupportResultForBoard` are all deleted. The `supportIssues` numerator
reverts to all classified tickets. Support classification (`support-classification.ts`,
`isTtbSupport`), the per-ticket `matchReason` field rendered in the ticket table's "Match"
column, and the MCP support tool's `matchReason` parameter are **retained unchanged**.

## Rationale

The filter was Support-only and unwanted; removing it completes the cross-report filter
unification. Keeping the classification and per-ticket `matchReason` preserves the
informative Match column and the MCP tool's programmatic filter, which are unaffected by the
dashboard UI change.

## Consequences

- **Positive:** Consistent filtering across reports; simpler Support page.
- **Negative / trade-offs:** No dashboard UI path to view only triage-board-linked support
  tickets (the MCP tool still offers this programmatically).
- **Risks:** If a dashboard TTB-linked view is wanted again, the UI toggle must be
  reinstated — the classification and MCP capability still back it.

## Related Decisions

- Relates to [0082](0082-remove-cycle-time-issue-type-filter.md) (analogous filter removal)
- [0083](0083-support-unified-board-and-period-model.md)
