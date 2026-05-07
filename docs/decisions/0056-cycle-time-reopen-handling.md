# 0056 — Cycle Time Reopen Handling

**Date:** 2026-05-07
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Reviewer Agent, Infosec Agent
**Proposal:** [0054](../proposals/0054-cycle-time-reopen-handling.md)

## Context

Cycle time was computed inconsistently across four services. `CycleTimeService` paired the
first `In Progress` transition with the **last** `Done` transition in the period, while
`SupportService`, `WeekDetailService`, and `SprintDetailService` each open-coded their own
variants of `firstInProgress → firstDone`. For issues that were re-opened
(`In Progress → Done → To Do → In Progress → Done`), the four views could disagree on the
same issue's cycle time — and the `CycleTimeService` figure double-counted the gap during
which the issue was reverted to `To Do`. Empty-data windows in `CycleTimeService.calculate()`
returned `band: 'excellent'` because `classifyCycleTime(0)` mis-classified zero as elite.

## Options Considered

### Option A — Per-service patches with no shared helper
- **Summary:** Fix each service independently, leaving the four implementations to drift again.
- **Pros:** smallest diff per service; no new module
- **Cons:** four code paths to keep aligned; future contributors will repeat the original drift; no obvious test surface to enforce agreement

### Option B — Shared pure helper consumed by all four services
- **Summary:** Extract a single `extractCycles` state machine that walks the changelog and emits the canonical `[{ start, end, isReopen }]` array, plus a representative cycle (latest completed) and a `reopenedIssueCount` aggregate. Refactor all four services to consume it.
- **Pros:** single source of truth for cycle semantics; easy to unit-test in isolation; trivially enforceable cross-view consistency test; surfaces `isReopen` and `reopenedIssueCount` for free
- **Cons:** larger diff up front; helper must remain pure (no DB / Logger / `Date.now()`) — a discipline that needs to hold

### Option C — Centralise in `CycleTimeService`, have other services call it
- **Summary:** Make `CycleTimeService` the owner and have `SupportService` / `WeekDetailService` / `SprintDetailService` invoke it.
- **Pros:** single owner module
- **Cons:** introduces cross-module runtime dependencies between feature modules that don't otherwise depend on each other; a service-level call is heavier than a pure-function call and pulls in DB / Logger semantics that are inappropriate for these consumers

## Decision

We will introduce a pure shared helper `backend/src/metrics/cycle.ts` (`extractCycles` +
`resolveResetNames`) that all four services consume to compute cycle time and surface
reopen-aware fields. The representative cycle is **the latest completed cycle** in the
period; `reopenedIssueCount` is the count of issues whose representative cycle is a reopen.
Empty data in `CycleTimeService.calculate()` and the metrics trend path returns
`{ medianDays: null, p85Days: null, band: null }` rather than mis-classifying zero as
`'excellent'`.

## Rationale

A pure helper is cheap to call from every service, trivially testable in isolation, and
makes cross-view consistency enforceable via a single integration test that instantiates
all four real services and asserts they agree on `cycleTimeDays` for a shared changelog
fixture. Choosing the **latest** completed cycle as the representative aligns with the
behaviour `CycleTimeService` already shipped with (so the public-facing aggregate doesn't
move when reopen handling lands), while explicitly surfacing `isReopen` and
`reopenedIssueCount` lets the UI distinguish the case for users. Returning `null` on empty
windows is the only honest answer — `'excellent'` was actively misleading.

## Consequences

- **Positive:**
  - Cycle time is identical across `/cycle-time`, `/support`, `/week`, `/sprint` views for any given issue
  - Reopens are now visible on the `/cycle-time` page via a banner driven by `reopenedIssueCount`
  - Empty data no longer paints quarters green in the trend chart
  - `extractCycles` is the single place to change cycle semantics in future
- **Negative / trade-offs:**
  - `CycleTimeTrendPoint` percentile and band fields are now `number | null` / `DoraBand | null` — every consumer must handle null
  - Reset status names default to `['To Do', 'Backlog', 'Open', 'Reopened']` when `BoardConfig.boardEntryStatuses` is null; teams using non-English status names must populate `boardEntryStatuses`
- **Risks:**
  - The helper must remain pure — adding any DB / Logger / time dependency would silently break the cross-view consistency contract
  - The trend chart's `connectNulls={false}` behaviour mirrors the sprint-report null-handling fix from ADR 0053 and must stay consistent if either is ever revisited

## Related Decisions

- [0024](0024-weekend-days-excluded-from-cycle-time.md) — Weekend days excluded from cycle time / lead time (still applies; `extractCycles` reuses `WorkingTimeService.workingDaysBetween`)
- [0053](0053-sprint-report-na-propagation.md) — Established the `null` propagation pattern for empty / not-applicable metric fields end-to-end; ADR 0056 applies the same pattern to cycle time
- [0046](0046-support-sprint-membership-population.md) — Defines how `SupportService` populates issues; cycle time on those issues now flows through the shared helper
