# Proposal 0043 — Support Ticket Report

**Status:** Accepted
**Author:** OpenCode
**Date:** 2026-05-06

---

## 1. Problem / Motivation

There is no visibility into the volume or cycle time of support tickets across engineering
boards. Support tickets are often interspersed with feature work in Jira and are not
surfaced as a distinct category in any existing report. Teams need to understand:

- What proportion of their capacity is being consumed by support work?
- How long does it take to resolve support tickets (cycle time)?
- Which boards carry the highest support burden?

Support tickets can be identified in two ways depending on how a board uses Jira:

1. **Label-based:** the issue carries one or more configured labels (e.g. `support`, `triage`).
2. **Link-based:** the issue has a configured link type pointing to a triage board key
   (e.g. "clones TTB-XXX"), meaning the ticket originated from or is associated with a
   support triage board.

Both mechanisms must be configurable per board, as teams have different Jira conventions.

---

## 2. Proposed Solution

### 2.1 Backend — `support` module

A new `SupportModule` (under `backend/src/support/`) containing:

- **`SupportService`** — identifies support tickets per board for a given date window and
  computes cycle time across them, reusing the existing `CycleTimeService` observation
  logic.
- **`SupportController`** — exposes `GET /api/support` and `GET /api/support/summary`.
- **DTOs** — `SupportQueryDto`, `SupportTicketDto`, `SupportSummaryDto`.

Support identification logic:

```
A JiraIssue is a support ticket for board B if ANY of:
  a) issue.labels ∩ boardConfig.supportLabels ≠ ∅
  b) JiraIssueLink where sourceIssueKey = issue.key
       AND linkTypeName = boardConfig.supportLinkType
       AND targetIssueKey starts with boardConfig.triageBoardKey + '-'
```

Both conditions are applied with `OR` — a ticket matching either criterion counts.

### 2.2 `BoardConfig` schema extension

Three new nullable columns added to `board_configs` via a TypeORM migration:

| Column            | Type               | Default | Description                                             |
| ----------------- | ------------------ | ------- | ------------------------------------------------------- |
| `supportLabels`   | `simple-json`      | `[]`    | Labels that identify a support ticket                   |
| `supportLinkType` | `varchar` nullable | `null`  | Link type name for triage-board links (e.g. `"clones"`) |
| `triageBoardKey`  | `varchar` nullable | `null`  | Triage board project key prefix (e.g. `"TTB"`)          |

`UpdateBoardConfigDto` extended with corresponding optional fields.

### 2.3 API endpoints

```
GET /api/support
  ?boardId=ACC,BPT,...   (default: all boards)
  &quarter=2026-Q1       (mutually exclusive with sprintId / period)
  &sprintId=123
  &period=YYYY-MM-DD:YYYY-MM-DD

→ SupportResult[]
  boardId: string
  totalIssues: number           — all work items in period (denominator)
  supportIssues: number         — count of identified support tickets
  supportPercentage: number     — (supportIssues / totalIssues) * 100, 2dp
  p50Days: number               — cycle time median across support tickets
  p95Days: number               — cycle time p95 across support tickets
  tickets: SupportTicketDto[]   — one entry per support ticket

GET /api/support/summary
  (same query params)

→ SupportSummaryDto
  totalIssues: number
  supportIssues: number
  supportPercentage: number
  p50Days: number
  p95Days: number
  byBoard: { boardId: string; supportIssues: number; percentage: number }[]
```

`/api/support` powers the per-board ticket table and per-board cycle time stats.
`/api/support/summary` powers the top-level aggregate stats and the pie chart.

### 2.4 Frontend — `/support` page

New route at `frontend/src/app/support/page.tsx`, styled to match the Cycle Time page:

- **Board selector** (all boards + individual toggle, same `BoardChip` pattern).
- **Period selector** (quarter / sprint / week toggle, same `ToggleChip` pattern).
- **Top-level summary row:**
  - `SupportPercentageStat` — "X% support tickets" across all selected boards.
  - `CycleTimePercentileCard` (reused) × 2 — p50 and p95 across all support tickets.
- **Pie chart:** `SupportDistributionChart` (Recharts `PieChart`) — slices per board,
  labelled with board ID and count.
- **Per-board results** (when a single board is selected or in "all" mode with one per board):
  - Per-board support % and cycle time summary line.
  - Paginated table of support tickets (same style as Cycle Time observation table):
    `Issue Key` | `Summary` | `Board` | `Cycle Time (days)` | `Completed` | `Band`.
    Issue Key is a Jira deep-link.
- **Empty state** card when no support tickets are identified in the period.
- **Sidebar nav entry:** `Support` with `Headphones` icon (Lucide), inserted after `Cycle Time`.

### 2.5 Data flow

```
User selects period / board
       ↓
frontend fetches GET /api/support/summary  (pie chart + top-level stats)
frontend fetches GET /api/support          (per-board stats + ticket table)
       ↓
SupportController → SupportService
  → resolve board IDs + date window (same helpers as MetricsService)
  → load JiraIssues for period (filtered by isWorkItem, boardId)
  → load JiraIssueLinks for those issue keys
  → load BoardConfig (supportLabels, supportLinkType, triageBoardKey)
  → classify support tickets (label OR link criteria)
  → delegate cycle time calculation to CycleTimeService.getCycleTimeObservations()
  → compute percentiles + percentage
  → return SupportResult[]
```

---

## 3. Acceptance Criteria

- [ ] `BoardConfig` has `supportLabels`, `supportLinkType`, `triageBoardKey` columns;
      updated via `PUT /api/boards/:boardId/config`.
- [ ] A migration exists implementing `up()` and `down()` for the three new columns.
- [ ] `GET /api/support` returns `SupportResult[]` scoped to the requested boards and period.
- [ ] Support ticket identification: label match OR link type + triage board key prefix match.
- [ ] Issues where neither criterion matches are not classified as support.
- [ ] Epics and subtasks are excluded from all calculations (ADR 0018).
- [ ] `supportPercentage` is calculated as `(supportIssues / totalIssues) * 100`, rounded to 2 dp.
- [ ] Cycle time (p50, p95) across support tickets respects `excludeWeekends` config (ADR 0024).
- [ ] `GET /api/support/summary` returns aggregate stats and a `byBoard` breakdown.
- [ ] `/support` page renders with all-boards view and individual board selector.
- [ ] Page renders top-level p50 and p95 cycle time cards.
- [ ] Page renders support percentage stat.
- [ ] Page renders `SupportDistributionChart` pie chart sliced by board.
- [ ] Page renders paginated ticket table with Jira deep-links and cycle time band badges.
- [ ] Empty state is shown when no support tickets exist in the selected period.
- [ ] `Support` nav item appears in the sidebar after `Cycle Time`.
- [ ] Unit tests cover: label classification, link classification, mixed, no match, epic exclusion.
- [ ] Frontend unit tests cover: `SupportDistributionChart` renders correct slice count,
      `SupportPercentageStat` renders correct text, empty state renders.
- [ ] MCP `get_support_tickets` tool calls `GET /api/support` and returns the response.
- [ ] MCP `get_support_summary` tool calls `GET /api/support/summary` and returns the response.
- [ ] MCP `support_health_report` prompt renders a markdown report with overall + per-board support stats.
- [ ] MCP tool and prompt unit tests added following the existing `mockApiGet` / `callTool` pattern.

---

## 4. Key Design Decisions

### D1: Reuse `CycleTimeService.getCycleTimeObservations()` for support cycle time

The existing service already handles `inProgressStatusNames`, `doneStatusNames`, weekend
exclusion, and anomaly counting. `SupportService` filters the issue list down to support
tickets first, then passes those keys to the cycle time logic — avoiding duplication.

### D2: New `support` module, not extending `metrics`

`metrics` is already large. Support identification is a separate concern from DORA and
cycle time calculation. A dedicated module keeps the boundary clean.

### D3: Label and link-type classification are `OR` conditions

A ticket matching either criterion is support. Both conditions are evaluated in a single
pass to avoid N+1 queries — issue links are bulk-fetched for all issue keys in the batch.

### D4: `triageBoardKey` prefix match on `targetIssueKey`

`JiraIssueLink.targetIssueKey` stores the full issue key (e.g. `TTB-42`). Prefix matching
(`targetIssueKey.startsWith(triageBoardKey + '-')`) is sufficient to identify triage board
links without storing a separate project key index.

### D5: `/api/support/summary` as a separate endpoint

The pie chart needs an aggregated cross-board breakdown that is lightweight to compute.
Separating it avoids the frontend having to download all ticket observations just to render
the summary row and pie chart.

### D6: Period resolution mirrors `MetricsService`

Quarter, sprint, and explicit date range resolution is extracted into a shared helper
already used by `MetricsService`. `SupportService` will call the same helper — no
duplication of period-resolution logic.

---

## 5. MCP Server Integration

The MCP package (`apps/mcp/`) must be extended to expose support data to AI assistants.

### 5.1 New tool file: `apps/mcp/src/tools/support.ts`

Two tools registered via `registerSupportTools(server)`:

| Tool name | Description | Parameters |
|---|---|---|
| `get_support_tickets` | Get support tickets and cycle time for one or more boards in a period | `boardId?` (comma-separated), `quarter?`, `sprintId?`, `period?` |
| `get_support_summary` | Get aggregate support stats and per-board breakdown (for pie chart data) | same as above |

Both call the corresponding backend endpoints (`/api/support` and `/api/support/summary`).

### 5.2 Registration in `server.ts`

`registerSupportTools(server)` added to `createServer()` alongside the existing tool
registrations.

### 5.3 Prompt: `support_health_report`

A new prompt added to `apps/mcp/src/prompts/index.ts`:

```
support_health_report
  Description: Generate a support ticket health report for a quarter,
               covering the percentage of support work, cycle time (p50/p95),
               and per-board breakdown.
  Parameters: quarter? (YYYY-QN, default: current quarter)
```

The prompt builder fetches `/api/support/summary` and (per-board) `/api/support` and
renders a markdown report with:
- Overall support percentage and cycle time
- Per-board support ticket counts and cycle time
- Data freshness note (from `/api/sync/status`)

### 5.4 MCP tests

- `test/tools/support.test.ts` — unit tests for `get_support_tickets` and
  `get_support_summary` using the existing `mockApiGet` / `callTool` pattern.
- `buildSupportHealthReport` exported from `prompts/index.ts` and tested in
  `test/tools/prompts.test.ts` (added to the existing prompts test file).

---

## 6. Out of Scope

- Support SLA tracking or target breach alerting.
- Trend view over multiple quarters (can be added in a follow-up proposal).
- Filtering support tickets by issue type (can be added as a filter chip later).
- Automatic triage board detection — the triage board key must be configured explicitly.

---

## 6. Infrastructure Addendum

No new cloud resources. No new IAM policies. No new secrets. No schema-breaking changes to
existing tables — the migration adds nullable columns with safe defaults.

---

## 7. Security Considerations

No PII is introduced. All data is mirrored internal Jira operational data (existing data
class). No new external integrations. No auth changes (ADR 0020 still applies).
`supportLabels`, `supportLinkType`, and `triageBoardKey` are board configuration strings —
they do not constitute secrets and do not require Secrets Manager storage.

---

## 8. Testing Plan

### Backend (Jest)

- `SupportService` unit tests (mocked repos):
  - Returns empty when no issues in period
  - Correctly classifies label-matched ticket
  - Correctly classifies link-matched ticket (matching `supportLinkType` + `triageBoardKey`)
  - Does not classify ticket when link type matches but triage board key does not
  - Classifies ticket matching both criteria only once (no double-count)
  - Excludes epics and subtasks (ADR 0018)
  - Returns correct `supportPercentage`
  - Returns correct p50/p95 cycle time across support tickets
- `SupportController` — not directly tested (thin controller)

### Frontend (Vitest)

- `SupportDistributionChart` — renders correct number of pie slices
- `SupportPercentageStat` — renders correct percentage text
- Empty state — renders when `tickets` is empty
- `api.ts` wrappers — `getSupportTickets`, `getSupportSummary` shape-checked

### MCP (Vitest)

- `test/tools/support.test.ts`:
  - `get_support_tickets` — calls correct endpoint with all param combinations
  - `get_support_summary` — calls correct endpoint, returns data verbatim
- `test/tools/prompts.test.ts` — `buildSupportHealthReport` renders section headings and
  handles unavailable data gracefully (null-safe)

---

## 9. Proposal Index

This proposal should be added to `docs/proposals/README.md` as entry 0043.
