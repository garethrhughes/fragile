# 0024 — Re-architect snapshot computation: one shared writer + change-scoped recompute

**Date:** 2026-08-12
**Status:** In Progress
**Source:** Manual
**Related proposal:** docs/proposals/0084-snapshot-compute-rearchitecture.md

## Summary

Re-architect the sync → snapshot subsystem so snapshot computation has a **single shared
implementation**: the prod AWS Lambda becomes a thin entrypoint that boots the same NestJS
compute module the in-process path uses, eliminating the duplicated `build*Rows` logic in
`snapshot.handler.ts`. Additionally, scope snapshot recompute to the boards a sync actually
changed, so incremental (hourly) sync stops paying the full ~150-row recompute cost.
Supersedes proposal 0083 (which covered only the manual-DI de-duplication and deferred the
shared-module approach and change-scoping).

## Background / Motivation

Snapshot computation exists in **two independent implementations** that drift:

- `InProcessSnapshotService` (local) — delegates to `MetricsService` / `SupportService`.
- `snapshot.handler.ts` (prod Lambda, ~1000 lines) — re-implements the same aggregation,
  trend, window, and quarter logic in standalone `buildAggregatePayload` /
  `buildDoraWindowRows` / `buildCycleTimeWindowRows` / `buildSupportWindowRows` /
  `enumerateQuarters` / `quartersToCompute` functions, and hand-wires every service via
  manual `new` against a hardcoded 17-entity `DataSource`.

This duplication caused a production DORA divergence incident and, most recently, the
cycle-time per-board quarter bug (`payload: [aggregate]` in the Lambda vs `payload: aggregate`
in-process → `results.flatMap is not a function` in prod). Every metric or snapshot-type
change must be made and verified in two places; the Lambda's hand-maintained entity list and
manual service constructors break at runtime (not compile time) when a service's constructor
changes. Adding a new report type touches ~10 sites across the two paths.

Separately, `syncAll` runs the full per-board + org snapshot recompute for **every** sync
regardless of mode, so the hourly incremental sync recomputes all windows + current quarter
for all 6 boards + org even when it fetched a handful of changed issues.

## Scope

**In scope**

- A single shared snapshot-compute module (NestJS) that both the in-process path and the
  Lambda invoke. The Lambda entrypoint bootstraps this module (via a Nest standalone
  application context or equivalent) and calls the same `computeBoard` / `computeOrg`
  methods — no re-implemented `build*Rows`, no hand-wired service `new`s, no hardcoded
  entity list to keep in lockstep.
- Delete the duplicated computation logic from `snapshot.handler.ts`; the handler becomes a
  thin adapter (event → boot module → call shared method → close).
- Preserve the org path's **merge-from-per-board-rows** strategy inside the shared writer so
  the org computation does not reload all boards' raw Jira data (avoids the historical
  timeout — a hard constraint from proposal 0083).
- **Board-level change scoping:** incremental sync records which boards changed (dirty set)
  and recomputes snapshots only for those boards plus the org rollup. Full/daily sync
  continues to recompute everything (deletion/backlog backstop, ADR 0078).
- Bring the Lambda's Terraform sizing/invocation config into line with reality and document
  the corrected values (memory/timeout/invocation type currently disagree with ADR 0040).
- Fix the board-config-change path to also refresh the org snapshot (currently only per-board).

**Out of scope**

- Introducing a queue / event bus / Step Functions (ADR 0040 deferred this until sync is the
  bottleneck; not the goal here — considered and deferred in the proposal).
- Changing the snapshot **read** contract (202-pending, `X-Snapshot-Age`, staleness) or the
  snapshot table schemas.
- Period-level recompute scoping (only board-level is in scope; period-level is a possible
  future refinement).
- Changing sync cadence, the advisory lock (ADR 0041), or the fire-and-forget 202 (ADR 0036).
- The ticket list staying live (ADR 0084) and sprint views staying live (ADR 0087) — unchanged.

## Acceptance Criteria

- Given the same board data, when snapshots are computed via the Lambda and via the
  in-process path, then they produce byte-identical rows for every snapshot type (DORA
  aggregate/trend/windows/quarters, cycle-time windows+quarters, support windows+quarters) —
  verified by a parity test.
- Given `snapshot.handler.ts`, then it contains no `build*Rows` / `buildAggregatePayload` /
  `enumerateQuarters` / `quartersToCompute` re-implementations and no hardcoded entity list —
  it boots the shared module and delegates.
- Given a new report type or period, then the compute change is made in exactly one place
  (the shared writer), not two.
- Given an incremental sync in which only board X changed, then only board X's snapshots (and
  the org rollup) are recomputed; boards Y/Z snapshots are not rewritten.
- Given a full/daily sync, then all boards' snapshots are recomputed (backstop preserved).
- Given the org snapshot computation, then it does not reload raw issue/changelog data for all
  boards (merge-from-per-board-rows preserved) — asserted by a test.
- Given a board-config change, then both the per-board and the org snapshot are refreshed.
- Given the deployed Lambda, then its Terraform memory/timeout/invocation-type match the
  documented values (ADR corrected).
- Full backend + frontend + MCP suites pass; the cycle-time array/object drift is impossible
  by construction (single code path).

## Open Questions

- Does booting a Nest standalone application context per Lambda invocation add unacceptable
  cold-start latency, or should the context be created once per warm container and reused?
  (To be resolved in design; leaning toward module-scoped reuse across warm invocations, as
  the current handler already reuses its DataSource.)

## Notes

- Preserves the split-heap intent of ADR 0040 (compute runs off the sync process in prod).
- Supersedes proposal 0083; its Option A (manual-DI unification) is replaced by the
  shared-module approach, and its deferred org-merge and change-scoping concerns are addressed
  here.
- Relevant settled ADRs to respect: 0036, 0040, 0041, 0078, 0081, 0083(→superseded), 0084,
  0087.
- Code/ADR contradictions to reconcile in the proposal: invocation type (`RequestResponse` vs
  documented `Event`), Lambda sizing (3008MB/300s vs documented 512MB/120s), staleness default
  (code 60min vs CLAUDE.md 2880min).
