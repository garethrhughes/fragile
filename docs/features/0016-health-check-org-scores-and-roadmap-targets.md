# 0016 — Health Check Org Overall Scores & Per-Team Roadmap Targets

**Date:** 2026-07-28
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0073-health-check-org-scores-and-roadmap-targets.md

## Summary

Extend the Engineering Health Check (feature 0014) with two org-level headline scores —
**overall stability** and **overall roadmap delivery** (each an average across teams) — and
a configurable **per-team roadmap-delivery target** (PLAT 50%, other boards 80%) that makes
roadmap RAG banding relative to each team's target rather than a single global threshold.

## Background / Motivation

The Health Check currently shows per-board scores and a RAG distribution but no single
org-level number for each dimension, and roadmap delivery is graded against one global
threshold (85/70). Teams have legitimately different roadmap-delivery expectations — the
Platform team (PLAT) does more reactive/unplanned work and targets ~50% roadmap delivery,
while product teams target ~80%. Grading every team against the same bar mislabels PLAT as
"at-risk" for hitting its actual goal, and makes any org average unfairly dragged down.

This feature (a) adds org overall scores for exec reporting and (b) grades each team
against its own target, so "healthy" means "meeting the target we set for this team."

## Scope

**In scope**

- Add `roadmapDeliveryTarget` (integer percentage, default **80**) to `BoardConfig`;
  seed PLAT to **50**. Editable via the existing board settings (`PUT /api/boards/:id/config`).
- Org **overall stability** = mean of each board's `stabilityScore` (fixed 85/70 banding
  unchanged).
- Org **overall roadmap delivery** = mean of each board's **attainment**
  `min(roadmapScore / roadmapDeliveryTarget, 1) × 100`, excluding boards whose roadmap
  score is null (nothing completed).
- Per-team roadmap RAG banding relative to target: `healthy ≥ target`,
  `watch ≥ target − 15`, `at-risk` below. Stability banding stays global (85/70).
- Surface each board's `roadmapDeliveryTarget` in the Health Check response and show it in
  the UI (e.g. "78% (target 80%)").
- Render the two org overall scores in the panel.
- Migration adds the column (default 80) with `up()`/`down()`.

**Out of scope**

- Per-team **stability** targets — stability keeps the fixed 85/70 banding.
- Targets as arithmetic weights — the target is a banding threshold + attainment
  denominator only.
- Changing the existing per-board `stabilityScore` / `roadmapScore` calculations.
- Historical/persisted org scores — computed on the fly like the rest of the Health Check.

## Acceptance Criteria

- Given completed-week Health Check data, the response includes `overallStabilityScore`
  = rounded mean of each board's `stabilityScore`.
- Given completed-week Health Check data, the response includes `overallRoadmapScore`
  = rounded mean of each board's attainment `min(roadmapScore / target, 1) × 100`, with
  null-roadmap boards excluded; when all boards are null, the value is `null`.
- Given `BoardConfig`, `roadmapDeliveryTarget` defaults to 80 and PLAT is seeded to 50.
- Given a board with `roadmapScore` ≥ its target, its `roadmapBand` is `healthy`;
  ≥ target−15 is `watch`; below is `at-risk`. Stability banding is unchanged (85/70).
- Given the board settings API, `roadmapDeliveryTarget` can be read and updated (validated
  integer 0–100).
- Each Health Check board entry includes its `roadmapDeliveryTarget`; the UI displays the
  target next to the roadmap score and the two org overall scores in the panel header.
- A migration adds `roadmapDeliveryTarget` (default 80) with a working `down()`.

## Open Questions

None — resolved at intake:
- Target drives per-team banding (not an arithmetic weight).
- Org roadmap number = mean of attainment vs target (not raw mean).
- Stored on `BoardConfig` + editable via settings UI.
- Stability keeps fixed 85/70 banding.
- Watch boundary = `target − 15` (mirrors the existing 15-point watch band).

## Notes

- Roadmap banding becomes **target-relative**, so `classifyHealthBand` must accept a
  target for the roadmap dimension while stability keeps the fixed-threshold helper. Keep
  both in `backend/src/lib/health-check-bands.ts`.
- Attainment is capped at 100 so a team beating its target does not inflate the org mean.
- Branches off `main` (which now includes the merged Health Check, feature 0014);
  independent of the open completeDate PR (#15 / feature 0015).
