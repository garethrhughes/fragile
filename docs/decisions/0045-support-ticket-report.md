# ADR 0045 — Support Ticket Report

**Status:** Accepted
**Date:** 2026-05-06
**Proposal:** [0043 — Support Ticket Report](../proposals/0043-support-report.md)

---

## Context

There was no visibility into the volume or resolution speed of support tickets across
engineering boards. Support work was interspersed with feature delivery in Jira and not
surfaced in any existing report. Two identification mechanisms are used across teams:
label-based tagging and issue-link-based association to a dedicated triage board.

## Decision

1. **New `support` NestJS module** (`backend/src/support/`) with `SupportService` and
   `SupportController`. Support tickets are identified per board using an `OR` rule:
   a ticket is classified as support if its labels intersect `BoardConfig.supportLabels`,
   or if it has a `JiraIssueLink` whose `linkTypeName` equals `BoardConfig.supportLinkType`
   and whose `targetIssueKey` starts with `BoardConfig.triageBoardKey + '-'`.

2. **`BoardConfig` schema extended** with three nullable columns (`supportLabels`,
   `supportLinkType`, `triageBoardKey`) via a TypeORM migration. Defaults are empty / null
   so existing boards are unaffected.

3. **Two API endpoints**:
   - `GET /api/support` — returns `SupportResult[]` (per-board: total issues, support count,
     percentage, p50/p95 cycle time, individual ticket list).
   - `GET /api/support/summary` — returns aggregate stats and `byBoard` breakdown for the
     pie chart. Kept separate to avoid downloading all ticket observations for summary-only views.

4. **Cycle time reuses `CycleTimeService.getCycleTimeObservations()`** — no duplication of
   weekend-exclusion, in-progress/done status resolution, or anomaly counting logic.

5. **Frontend `/support` page** styled to match the Cycle Time report: board selector,
   period selector (quarter/sprint/week), top-level p50/p95 cycle time cards, support
   percentage stat, `SupportDistributionChart` (Recharts pie by board), paginated ticket
   table with Jira deep-links and cycle time band badges. Sidebar entry after Cycle Time.

6. **MCP package extended** with `get_support_tickets` and `get_support_summary` tools,
   plus a `support_health_report` prompt that renders a markdown summary of support load
   and cycle time for a given quarter.

## Consequences

- Support ticket classification rules must be configured per board via
  `PUT /api/boards/:boardId/config`; boards with no configuration return zero support
  tickets (no false positives).
- Epics and subtasks are excluded (ADR 0018). Weekend-exclusion respects WorkingTimeConfig
  (ADR 0024). Issue links are bulk-fetched to avoid N+1 queries.
- The three new `BoardConfig` columns are nullable with safe defaults; no existing board
  configurations are affected.
- AI assistants using the MCP server gain `get_support_tickets`, `get_support_summary`,
  and the `support_health_report` prompt for support load analysis.
