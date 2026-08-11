# 0088 — Single shared snapshot-compute writer; Lambda as thin Nest entrypoint

**Date:** 2026-08-12
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0084-snapshot-compute-rearchitecture.md

## Context

DORA / Cycle Time / Support snapshots were produced by two independent implementations:
`InProcessSnapshotService` (local, delegating to `MetricsService`/`SupportService`) and the
prod Lambda `snapshot.handler.ts` (~1060 lines re-implementing the same aggregation/trend/
window/quarter logic, hand-wiring services via manual `new`, with its own hardcoded entity
list). The two drifted, causing a prod DORA divergence incident and the cycle-time per-board
quarter payload bug. ADRs 0040 and 0087 anticipated unifying them (via proposal 0083).

## Options Considered

### Option A — Manual-DI unification (proposal 0083)
- **Summary:** Lambda keeps hand-wiring low-level services and constructs the shared writer.
- **Cons:** Removes the `build*Rows` duplication but keeps the manual-`new` graph and
  hardcoded entity list — a service constructor change still breaks the Lambda at runtime.

### Option B — Lambda boots the real Nest module (chosen)
- **Summary:** Promote the writer to `SnapshotComputeService` in a `SnapshotComputeModule`;
  the Lambda handler boots a cached NestJS standalone application context
  (`SnapshotWorkerModule`) and resolves the service.
- **Pros:** One implementation; identical rows by construction; removes manual DI + entity
  list; the Lambda zip already bundles the full app so no new bundle cost.
- **Cons:** One-time Nest context boot per cold container (mitigated by module-scoped reuse).

### Option C — Framework-free shared compute function
- **Cons:** Reintroduces a bespoke dependency-passing convention that diverges from the DI
  used everywhere else and must still track service constructor changes.

## Decision

Snapshot computation lives in a single `SnapshotComputeService` (in `SnapshotComputeModule`,
importing `MetricsModule` + `SupportModule` + the snapshot repos). The prod Lambda
`snapshot.handler.ts` is a thin adapter that boots a NestJS standalone application context for
`SnapshotWorkerModule` — cached module-scope, reused across warm invocations — and delegates
to `SnapshotComputeService.computeBoard` / `computeOrg`. All `build*Rows`,
`buildAggregatePayload`, quarter enumeration, manual service `new`, the hardcoded entity list,
and the `configServiceStub` are deleted. Local (in-process fallback) and prod (Lambda) run the
identical service.

`computeOrg()` reloads all boards via `MetricsService`/`SupportService` (bounded
`TrendDataLoader`, ~6 scoped queries per board) rather than the Lambda's former
merge-from-per-board-rows algorithm — that merge was legacy defensiveness against a
pre-`TrendDataLoader` implementation that timed out and no longer applies. This revises (and
retires) the "no raw reload in `computeOrg`" constraint from proposal 0083.

## Rationale

Booting the real module removes the entire class of drift bugs (there is one code path) and
the manual-DI fragility, at no bundle cost (the zip already ships the app). Reloading in
`computeOrg` gives one obvious code path; the historical timeout risk is gone with the modern
bounded loader.

## Consequences

- **Positive:** One snapshot implementation; drift (e.g. cycle-time array/object) impossible;
  a new report/period is added in one place; ~1200 fewer lines; the Lambda no longer breaks at
  runtime when a service constructor changes (real DI).
- **Negative / trade-offs:** A cold Lambda container pays a one-time Nest bootstrap; mitigated
  by module-scoped context reuse across warm invocations.
- **Risks:** If the standalone context boot ever becomes a material cold-start cost, trim the
  worker module further. Low likelihood.

## Related Decisions

- Supersedes proposal 0083; fulfils the unification anticipated by
  [0040](0040-lambda-post-sync-dora-snapshot-computation.md) and
  [0087](0087-snapshot-quarter-cycle-time-support.md).
- [0089](0089-change-scoped-snapshot-recompute.md), [0090](0090-snapshot-config-reconciliation.md)
