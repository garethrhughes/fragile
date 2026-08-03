# 0075 — Remove `roadmapDeliveryTarget` from BoardConfig

**Date:** 2026-08-03
**Status:** Accepted
**Deciders:** Requester, Architect Agent
**Proposal:** docs/proposals/0076-healthcheck-report.md

## Context

`BoardConfig.roadmapDeliveryTarget` (integer %, default 80, PLAT 50) was introduced by
ADR 0067 to drive per-team roadmap RAG banding and org roadmap attainment in the original
per-board Health Check panel. That panel and the `all-items` module were removed when the
Healthcheck was rebuilt (ADR 0070), and the org-wide refactor (ADR 0074) made the Roadmap
score a single pooled figure banded against a fixed org target (`ORG_ROADMAP_TARGET = 80`).
The `roadmapDeliveryTarget` field is therefore no longer read by any calculation — it is
only stored, exposed on `UpdateBoardConfigDto`, surfaced in `api.ts`, and editable on the
settings page. Dead configuration invites confusion (users can set a value that does nothing).

## Options Considered

### Option A — Remove the field entirely
- **Summary:** Drop the column (migration), entity property, DTO field, api.ts type, settings
  input, and test fixtures.
- **Pros:** No dead config; UI no longer implies a knob that has no effect.
- **Cons:** Requires a schema migration; loses the value if per-board targets return later
  (recoverable via the migration `down()` and Jira config).

### Option B — Re-wire the field into the org Roadmap band
- **Summary:** Keep it and derive the org target from the scrum boards' values.
- **Cons:** Reintroduces the per-board-vs-org ambiguity ADR 0074 deliberately removed; the
  org score is a single pooled number, so a per-board target does not map cleanly.

### Option C — Leave it stored but unused
- **Cons:** Dead editable config remains, misleading operators.

## Decision

Remove `roadmapDeliveryTarget` from `BoardConfig` entirely: drop the `board_configs` column
via a reversible migration, and remove the entity property, `UpdateBoardConfigDto` field,
the `api.ts` `BoardConfig` type member, and the settings-page input. The Healthcheck Roadmap
band continues to use the fixed `ORG_ROADMAP_TARGET = 80` constant (ADR 0073/0074).

## Rationale

The field has no remaining consumer after ADR 0070/0074. Removing it keeps configuration
honest and the settings UI truthful. A single fixed org target matches the org-wide, pooled
Roadmap score. The migration `down()` restores the column (default 80, PLAT 50) if per-board
targets are ever reintroduced.

## Consequences

- **Positive:** No dead config; simpler entity, DTO, and settings page.
- **Negative / trade-offs:** One-way schema change (reversible via `down()`); the Roadmap org
  band threshold is now only changeable in code (`ORG_ROADMAP_TARGET`).
- **Risks:** Low. If configurable org targets are wanted later, add a single org-level setting
  rather than a per-board column.

## Related Decisions

- Supersedes the `roadmapDeliveryTarget` portion of ADR 0067 (the org stability/score parts of
  0067 were already superseded by ADR 0070/0074). Amends ADR 0073 (Roadmap band now uses a
  fixed constant, not the per-board field).
