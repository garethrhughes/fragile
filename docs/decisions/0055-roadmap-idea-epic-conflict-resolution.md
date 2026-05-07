# 0055 — Roadmap Idea↔Epic Conflict Resolution

**Date:** 2026-05-07
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Reviewer Agent, Infosec Agent
**Proposal:** [0053](../proposals/0053-roadmap-idea-epic-conflict-resolution.md)

## Context

A single Jira epic can be referenced by more than one JPD idea via
either `JpdIdea.deliveryIssueKeys` (the array path used in
`filterIdeasForWindow`) or via `JiraIssueLink` direct links (the path
used in `buildDirectLinkIdeaMap`, ADR 0044). When this happens the
roadmap accuracy calculation has to choose which idea's `targetDate`
defines on-time delivery for that epic. The legacy behaviour was
"latest target wins" — implemented silently and inconsistently in two
separate code paths, with no surface anywhere in the API or UI showing
that a conflict had occurred. This made roadmap accuracy results
unexplainable when ideas with different target dates referenced the same
epic, and any change of rule would silently flip on-time classification
for affected boards with no operator visibility.

## Options Considered

### Option A — Keep "latest target wins", document the rule
- **Summary:** No code change; add a CLAUDE.md note explaining the existing behaviour.
- **Pros:** Zero risk to historical results.
- **Cons:** Still silent — operators have no way to see which epics are conflicted; doesn't address the second code path having drifted; doesn't satisfy the strict-commitment interpretation that audits and stakeholders expect.

### Option B — Pick the idea with the most recent JPD update timestamp
- **Summary:** Use `JpdIdea.updatedAt` as the tie-breaker.
- **Pros:** Reflects "latest operator intent".
- **Cons:** Still silent; non-deterministic across syncs (an unrelated edit to one idea changes which target date defines on-time); harder to explain than a date-based rule.

### Option C — Earliest target wins as default, configurable per board, surface conflicts explicitly
- **Summary:** Adopt strict-commitment interpretation (`'earliest'`) as the default. Add `RoadmapConfig.epicConflictResolution: 'earliest' | 'latest'` so boards can opt out. Extract a single shared `resolveEpicIdeas` helper used by both code paths. Add `GET /api/roadmap/epics` to expose per-epic detail with the primary idea and any conflicting ideas. Add a `⚠ N conflicts` badge on the roadmap UI so operators can see exactly which epics are conflicted and by how many days.
- **Pros:** Aligns with the strictest interpretation of commitment ("we said this would land by X"); surfaces conflicts so operators can resolve them in JPD; eliminates code-path drift via the shared helper; per-board override gives an escape hatch for teams that genuinely treat the latest re-baseline as the commitment.
- **Cons:** Behaviour change — boards with multi-idea epics where targets differ will see on-time classification flip on next render. Mitigated by the visible badge.

## Decision

We will adopt Option C. Conflict resolution moves into a single shared
pure helper `resolveEpicIdeas` in `backend/src/roadmap/`. Both
`filterIdeasForWindow` (in `roadmap.service.ts`) and
`buildDirectLinkIdeaMap` (in `metrics/roadmap-link-utils.ts`) route
through the helper so the rule cannot drift between paths. The default
rule is `'earliest'` target wins (strictest commitment interpretation),
configurable per board via the new `RoadmapConfig.epicConflictResolution`
column. A new `GET /api/roadmap/epics` endpoint returns per-epic detail
(`primaryIdea`, `conflictingIdeas[]`, `coverageState`, `resolvedSource`)
and a `roadmap_coverage_computed` structured log line is emitted on
every roadmap computation. The frontend `/roadmap` page renders a
`⚠ N conflicts` badge with a tooltip listing each conflicting idea's
key, target date, and signed `daysFromPrimary`.

## Rationale

Option C is the only option that fixes the silent-rule problem in
addition to picking a rule. The shared helper guarantees that future
audits cannot find one code path resolving a conflict differently from
the other — a defect class that has already happened once on this
codebase (ADR 0044's direct-link path was added later and reproduced
the conflict logic open-coded). The `'earliest'` default matches how
both engineers and stakeholders typically describe a commitment
("we said it'd be done by 1 June, not 1 September"), and the per-board
override means teams that actively re-baseline can opt back into
`'latest'` without a code change. The new endpoint and badge close the
explainability gap — a stakeholder asking "why is this epic late?" can
now see directly that two ideas disagreed on the target date, by how
many days, and which one was treated as primary.

## Consequences

- **Positive:**
  - Roadmap on-time classification is now deterministic and explainable for multi-idea epics.
  - Conflict resolution lives in exactly one place; both code paths are forced through it.
  - Operators can see conflicted epics directly in the UI rather than discovering them via support questions.
  - The `roadmap_coverage_computed` log line gives infra-level visibility into how many conflicts each board carries over time.
- **Negative / trade-offs:**
  - Boards with existing multi-idea epics where targets differ will see on-time classification flip on next render. The `⚠` badge surfaces this; per-board override is available.
  - The new endpoint currently supports only scrum-sprint mode; kanban and quarter modes return HTTP 400. Aggregate accuracy still works for those modes — only the per-epic detail is unavailable. Recorded as a follow-up.
  - The structured log line uses `boardId=` (not `jpdKey=` as the proposal wording suggested) because a single request scope can span multiple JPD projects per `RoadmapConfig`; `boardId` is the actual request scope and is stable across syncs.
- **Risks:**
  - Boards with the `'latest'` override risk silently re-baselining the commitment surface — mitigated by the override being explicit per-board YAML and the conflict count being logged on every computation.
  - `ruleSummary` in the log line picks the first iteration value across ideas spanning multiple roadmaps with different rules; logged value can misrepresent the rule that actually applied. Acceptable for an operational log; flagged for follow-up if multi-roadmap boards become common.

## Related Decisions

- [ADR 0044](0044-roadmap-coverage-condition-c.md) — Condition C added the `JiraIssueLink` direct-link path to roadmap idea↔epic resolution, which reproduced the conflict logic open-coded in a second place. ADR 0055 collapses the two paths back into a single shared helper.
- [ADR 0021](0021-jira-field-ids-externalised.md) — Per-board YAML config pattern reused for `epicConflictResolution`.
- [ADR 0020](0020-no-application-layer-auth.md) — `GET /api/roadmap/epics` follows the same access posture as `/api/roadmap/accuracy` (no app-layer guard; CloudFront WAF allowlist per ADR 0034).
- [ADR 0040](0040-lambda-dora-snapshot-computation.md) — No equivalent snapshot table for roadmap; per-epic detail is computed on demand from cached Jira data, so no migration is required for the rule flip.
