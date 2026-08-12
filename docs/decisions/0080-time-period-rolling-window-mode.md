# 0080 — Time-period rolling-window reporting mode

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0079-unified-reporting-periods-dora-cycle-time.md

## Context

Neither the DORA nor Cycle Time report could be viewed over a simple rolling window (e.g.
"last 30 days") independent of quarter/sprint boundaries. A "Time period" option was
required with windows of 7, 30, and 90 days, and a trend chart bucketed across that window.

## Options Considered

### Option A — Client computes a date range and sends `period=YYYY-MM-DD:YYYY-MM-DD`
- **Summary:** Frontend computes `[start, end]` and reuses the existing range param.
- **Cons:** The backend must own trend bucket granularity (daily vs weekly), which depends
  on window length; a raw range loses that semantic and spreads trend logic across the
  boundary.

### Option B — First-class `window` param, server owns bucketing
- **Summary:** Send `window` (7|30|90); backend derives the date range and bucket
  granularity.
- **Pros:** Trend logic stays server-side; window semantics are explicit and validated.
- **Cons:** New query param on multiple endpoints.

## Decision

Add a first-class `window` query param (7, 30, or 90 days) with `mode=timeperiod`. A window
of N days ends at **23:59:59.999 of the last full day** in the configured timezone
(`TIMEZONE`) — i.e. up to the end of yesterday — and spans exactly N full calendar days
(`windowToDates`). Trend granularity is server-owned: 7-day and 30-day windows produce daily
buckets; 90-day windows produce weekly buckets (`listRollingBuckets`). Weekend/working-day
rules for the underlying metrics are unchanged.

## Rationale

Ending the window at the last full day gives stable, complete data (no partial "today"),
using the timezone helpers already in `tz-utils.ts`. Keeping `window` first-class lets the
backend own bucket granularity, honouring the project rule that logic lives in services.

## Consequences

- **Positive:** Simple rolling-window views; consistent tz-correct boundaries; trend
  bucketing is a pure, tested function.
- **Negative / trade-offs:** "Last N days" excludes the current in-progress day by design;
  users wanting up-to-the-minute data must use another view.
- **Risks:** If sub-daily or arbitrary windows are later required, the fixed 7/30/90 set and
  daily/weekly bucketing must be extended.

## Related Decisions

- [0079](0079-unified-board-and-period-model.md), [0081](0081-time-period-snapshots.md)
- Builds on [0024](0024-weekend-exclusion-from-cycle-time-and-lead-time.md) weekend
  exclusion (unchanged) and the quarter helpers in `period-utils.ts`.
