# 0087 — Snapshot quarter views for Cycle Time & Support

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent
**Proposal:** docs/proposals/0082-snapshot-quarter-cycle-time-support.md

## Context

Time-period views for DORA, Cycle Time and Support are snapshot-served and instant. DORA's
quarter view is also snapshotted. Cycle Time (aggregate + trend) and Support (summary) quarter
views were still computed live per request — loading all board issues + full changelogs +
the working-time loop — making the default quarter reports slow while the 90-day view was
instant.

## Decision

Extend the snapshot mechanism to the quarter views for Cycle Time (aggregate + trend) and
Support (summary), for every quarter the UI can request (the quarter set derived from closed
sprints via `PlanningService.getQuarters`).

- New snapshot types (no migration — JSONB columns exist): `aggregate-<quarter>` /
  `trend-<quarter>` on `CycleTimeSnapshotType`; `summary-<quarter>` on `SupportSnapshotType`
  (e.g. `aggregate-2026-Q1`).
- **Writer:** recompute the current quarter every sync; compute each historical (closed) quarter
  once and skip it on later syncs (closed-quarter data is immutable). Applies to both the
  in-process writer and the Lambda handler.
- **Controllers:** when a `quarter` is supplied (and no `sprintId`), serve from the snapshot
  with the same `202 { status: 'pending' }` + `X-Snapshot-Stale` / `X-Snapshot-Age` contract as
  the time-period branch.
- **Sprint mode stays live** for these reports; the Support **ticket list** stays live
  (ADR 0084 — only the summary is snapshotted).

Builds on ADR 0040 (Lambda snapshots), 0079/0081 (time-period snapshots), 0084 (support summary
snapshots).

> **Implementation note (2026-08-11):** the in-process snapshot writer
> (`InProcessSnapshotService`) and the read controllers implement this decision now. The
> **Lambda handler** (`snapshot.handler.ts`) still re-implements metric aggregation
> independently and has **not** yet been extended for quarter snapshots — so in the prod
> (Lambda) path, quarter Cycle Time / Support / historical-DORA views remain live-computed until
> a follow-up refactors the Lambda to reuse the shared writer (the same duplication that caused
> the ADR 0068-era DORA divergence). Tracked as a separate proposal.

## Consequences

- **Positive:** Quarter Cycle Time / Support reports load instantly (snapshot read), matching
  the time-period views; the heavy live compute moves off the request path to sync/Lambda.
- **Negative / trade-offs:** A backdated Jira edit to a *closed* quarter won't refresh its
  snapshot until forced (historical quarters aren't recomputed each sync); rare, and worth the
  ~7× sync-cost saving over recomputing all quarters. First sync after deploy backfills all
  historical quarters once.
- **Risks:** Snapshot row growth is one extra row per board per quarter per report — bounded by
  the number of quarters with closed sprints (currently 8). Negligible.

## Related Decisions

- Builds on [0040](0040-lambda-dora-snapshot.md), [0081](0081-time-period-snapshots.md),
  [0084](0084-support-summary-snapshots.md).
