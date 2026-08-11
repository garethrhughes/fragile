# 0083 — Unify the Lambda snapshot handler with the in-process snapshot writer

**Date:** 2026-08-11
**Status:** Superseded by [0084](0084-snapshot-compute-rearchitecture.md)
**Author:** Architect Agent
**Related ADRs:** 0040 (Lambda post-sync snapshots), 0087 (quarter snapshots); addresses the
duplication behind the ADR 0068-era DORA divergence incident

## Problem Statement

DORA/Cycle Time/Support snapshots are produced by **two independent implementations**:

- **In-process** (`InProcessSnapshotService`) — used locally and in any non-Lambda env. Calls
  `MetricsService` / `SupportService` (the same code the live API uses).
- **Lambda** (`snapshot.handler.ts`, ~800 lines) — used in prod (ADR 0040). Manually
  instantiates the low-level services and **re-implements** the aggregation/trend/window logic
  in standalone `build*Rows` functions, rather than calling `MetricsService`.

These two copies drift. This already caused a production incident: prod DORA Deployment
Frequency read 0.26 while the live detail endpoint read 0.54, because the deployed Lambda
computed a stale/different definition than the API. Any metric change now has to be made in
two places and verified twice — and the quarter-snapshot work (proposal 0082) landed only in
the in-process writer, so **prod quarter views are not snapshotted at all** until the Lambda is
brought into line.

## Goal

One source of truth for snapshot computation. The Lambda should invoke the **same writer** the
in-process path uses, so a metric or snapshot-type change is made once and shipped to both.

## Constraints discovered

- The Lambda **per-board** path can reuse the shared writer directly — it already instantiates
  every dependency (`DeploymentFrequencyService`, `LeadTimeService`, `CfrService`,
  `MttrService`, `CycleTimeService`, `SupportService`, all repos).
- The Lambda **org** path is **intentionally different**: it merges the already-written
  per-board `trend` snapshot rows rather than reloading all boards' raw Jira data, because the
  raw-reload approach previously **timed out** on large boards. A naive "call
  `computeOrg()` which reloads everything" would reintroduce that timeout. The unification must
  preserve the org path's merge-from-per-board-rows strategy, OR move that strategy into the
  shared writer so both paths use it.

## Proposed Solution

### Option A — Lambda constructs and calls `InProcessSnapshotService` (chosen direction)

- In `snapshot.handler.ts`, build `MetricsService` + `SupportService` from the already-created
  low-level services (manual DI, as today), then build `InProcessSnapshotService` from those +
  the snapshot repos + sprint repo.
- **Per-board event:** call `snapshotService.computeBoard(boardId)` — deletes
  `buildCycleTimeWindowRows`, `buildSupportWindowRows`, the DORA `build*Rows`, and the quarter
  logic duplication. Quarter snapshots (proposal 0082) then work in prod for free.
- **Org event:** keep the current merge-from-per-board-rows implementation **unless** the
  equivalent merge is first moved into `InProcessSnapshotService.computeOrg()` and proven not to
  reload raw data. Preserving the org merge is a hard requirement (timeout regression risk).

### Option B — Extract a shared pure `SnapshotComputation` module

- Move the row-building logic into a framework-agnostic module both `InProcessSnapshotService`
  and the Lambda import. More work, but removes the "Lambda instantiates Nest services by hand"
  smell entirely.

Option A is the smaller, lower-risk first step and directly kills the divergence; Option B can
follow if the manual-DI wiring proves fragile.

## Acceptance Criteria

1. The Lambda per-board path produces byte-identical snapshot rows to `computeBoard()` for the
   same data (verify against a fixture board: DORA aggregate/trend/windows/quarters, cycle-time
   windows+quarters, support windows+quarters).
2. The duplicate `build*Rows` metric logic is deleted from `snapshot.handler.ts`.
3. The org path still merges per-board rows (no raw-data reload) — confirmed by a test asserting
   the org handler does not call the raw issue/changelog repos.
4. Prod quarter DORA/Cycle Time/Support views are snapshot-served after this ships (closes the
   ADR 0087 gap).
5. A regression guard for the original incident: a test asserting DORA DF from the snapshot path
   equals the live `DeploymentFrequencyService` event-count definition.

## Risks & Mitigations

- **Org-path timeout regression** — the top risk. Mitigation: do not change the org merge in this
  change; only unify the per-board path first. Ship org unification separately if at all.
- **Manual DI drift** — the Lambda hand-wires services; if a service gains a constructor dep the
  Lambda breaks at runtime, not compile time. Mitigation: a Lambda smoke test that constructs the
  full graph; longer term, Option B.
- **Cold-start / bundle size** — pulling `MetricsService` in doesn't add deps it doesn't already
  transitively use. Negligible.

## Rollout

- Ship behind the existing manual deploy; after deploy, trigger a sync and verify prod DORA
  aggregate/detail agree (the incident check) and quarter views return snapshots not 202-forever.
- Requires `make lambda-build && make tf-apply` (the Lambda is a separate artifact — the exact
  drift this proposal is about; the Makefile now rebuilds the zip on apply).
