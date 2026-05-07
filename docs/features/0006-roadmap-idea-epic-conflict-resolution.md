# Feature 0006 — Roadmap Idea↔Epic Conflict Resolution

**Status:** In Progress
**Proposal:** [0053](../proposals/0053-roadmap-idea-epic-conflict-resolution.md)
**ADR:** [0055](../decisions/0055-roadmap-idea-epic-conflict-resolution.md) (pending)
**Date:** 2026-05-07

---

## Summary

Make many-ideas-to-one-epic conflict resolution explicit, deterministic,
and surfaced. Default rule changes from "latest target wins" (current,
silent) to "earliest target wins" (configurable). Both code paths
(`filterIdeasForWindow` and `buildDirectLinkIdeaMap`) route through a
shared `resolveEpicIdeas` helper. New `GET /api/roadmap/epics` endpoint
exposes per-epic detail with conflicting ideas. New frontend view
renders a `⚠ N conflicts` badge with tooltip on affected epics. New
schema column `RoadmapConfig.epicConflictResolution` (reversible
migration, default `'earliest'`). YAML loader, zod schema, and example
YAML updated.

## Acceptance Criteria

The 11 ACs from proposal 0053 §"Acceptance Criteria" apply verbatim.
Additionally:

A. No `process.env` access introduced; all config via `ConfigService`.
B. No new dependencies.
C. No `any` casts in new code.
D. Backend Jest suite remains green; frontend Vitest suite remains green.
E. Migration is the next free timestamp slot in `backend/src/migrations/`.

## Out of Scope

- Re-running historical roadmap snapshots. The endpoint computes from
  cached data on each request, so the next render reflects the new rule
  automatically.
- Editing JPD ideas from the dashboard (resolution must happen in JPD).
- Release-note communication to users.
- Caching or pre-computation of per-epic detail (read on demand).

## Notes

The behaviour change is the visible risk: any board with multi-idea
epics where the targets differ will see on-time classification flip on
next render. The new `⚠` badge makes this discoverable. Operators can
quantify exposure ahead of deploy by querying for ideas sharing
`deliveryIssueKeys` entries and inspecting the differing `targetDate`s.
