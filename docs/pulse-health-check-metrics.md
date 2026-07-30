# Pulse Health Check — Metrics Reference

This document explains each metric shown on the **Pulse Health Check** panel, exactly how
it is calculated, and a proposed **Support Load** metric.

The Health Check appears above the Pulse report on `/all-items` for **completed weeks only**
(never the current in-progress week). Every score is on a 0–100 scale.

Source of truth for the calculations:

- `backend/src/all-items/all-items.service.ts` (`calculateHealthScore`, `buildHealthCheck`)
- `backend/src/lib/health-check-bands.ts` (banding, attainment, org means)

---

## The working set (what the scores are measured against)

- **Scrum:** the union of *committed* + *added* issues across the sprint(s) overlapping the
  week, with sprint membership reconstructed from the Jira changelog (ADR 0006).
- **Kanban:** issues whose board-entry date falls within the week ("pulled in").
- `completedCount` — issues that transitioned to a Done status within the week.
- `onRoadmapCount` — of the completed issues, how many were linked to a JPD roadmap idea
  that was active at completion time.

---

## 1. Stability

**Question it answers:** *Did the team do roughly what it planned / keep flow balanced?*

- **Scrum:** `committed / (committed + added) × 100`
  - Uses sprint-lifetime membership (the same source as the Planning Accuracy report).
  - 100% = nothing added mid-sprint; a lower score means more unplanned scope crept in.
  - If a sprint has no members yet, the score is 100 (no disruption to measure).
- **Kanban:** `min(completed / pulledIn, 1) × 100` — *throughput balance* (ADR 0062).
  - A kanban team is "stable" when it completes about as much as it pulls in.
  - Over-delivery (e.g. clearing a backlog) is capped at 100 — it is **not** penalised.

**Banding (fixed thresholds):**

| Band | Range |
|---|---|
| healthy | ≥ 85 |
| watch | 70–<85 |
| at-risk | < 70 |

---

## 2. Roadmap Delivery

**Question it answers:** *Was the completed work planned (on the roadmap)?*

- **Score (`roadmapAlignmentScore`):** `onRoadmapCount / completedCount × 100`.
  - If the team completed **nothing** that week, the score is `null` / **"n/a"** — you
    cannot measure the alignment of zero output.

- **Banding is per-team, relative to that team's target** (proposal 0073):

| Band | Rule |
|---|---|
| healthy | score ≥ team's `roadmapDeliveryTarget` |
| watch | score ≥ target − 15 |
| at-risk | below target − 15 |

- Default target is **80%**. **PLAT is set to 50%** (it does more reactive/unplanned work),
  so PLAT at 55% is *healthy*, not at-risk. Targets are configurable per board in Settings.

---

## 3. Org overall scores (the two header numbers)

- **Org Stability** = the plain mean of every team's stability score.
- **Org Roadmap** = the mean of each team's **attainment**, where
  `attainment = min(score / target, 1) × 100`.
  - Averaged only over teams that completed something (null-roadmap teams are excluded).
  - Attainment is capped at 100 so a team beating its target cannot mask another team
    underperforming.

---

## 4. RAG distribution

The "X healthy / Y watch / Z at-risk / N n/a" counts are simply tallies of each team's band
for that dimension.

- Stability never produces `n/a`.
- Roadmap counts teams that completed nothing as `n/a` (excluded from the RAG buckets).

---

## Computed but intentionally excluded: Support Burden

The backend already computes a `supportBurdenScore = (1 − supportCount / totalItems) × 100`,
but it is **deliberately excluded from the overall/health score**. From the code:

> Support burden is informational only — excluded from overall to avoid penalising teams for
> support work they have no control over.

Support counts currently appear only as context on the Pulse rows.

**How an issue is classified as "support"** (per-board config on `BoardConfig`): it matches
any of —

- `supportEpics` — the issue is a child of a designated support epic,
- `supportLabels` — the issue carries a support label, or
- `supportLinkTypes` + `triageBoardKey` — the issue links to the triage board (the "TTB"
  signal).

---

## Proposal: a Support Load metric for the team

The raw ingredients already exist (`supportCount`, `ttbSupportCount`, per-board support
classification); they are just not surfaced as a first-class, trended metric.

### What to measure

**Support Load = `supportCount / totalItems × 100`** per team per week — the proportion of
the team's work that was reactive/support. (This is the positive-framed inverse of the
existing `supportBurdenScore`, which reads more naturally as a "load".)

Always show it **with the absolute count** — e.g. `27% (8 of 30)` — because a percentage
alone hides volume (20% of 5 items ≠ 20% of 50).

### How to present it (recommendation)

Add a **third, clearly-separated column: "Support Load"** — presented as **context, not a
graded RAG score**, mirroring how the code already treats support burden. Support volume is
largely demand-driven (incoming tickets), not team-controlled, so RAG-banding it would
create perverse incentives (deflecting tickets to look "green").

- **Per team:** `Support 27% (8 of 30)` with a 4-week sparkline trend (reuse the existing
  4-week trend machinery).
- **Org level:** a distribution / total — e.g. "62 support items across teams this week,
  PLAT carrying 40%" — to see where load concentrates.

### Why trend, not a threshold

The value is in the **trend** and **cross-team comparison**, not an absolute bar:

- A team whose support load is **climbing week-on-week** is the signal worth acting on
  (growing operational drag).
- A team carrying a **disproportionate share** of the org's support (like PLAT) is a
  staffing / rotation conversation.

### Implementation sketch (reuses existing plumbing)

1. Backend `HealthCheckBoard` already carries `volume.support` and
   `volume.completed`/`pulledIn` — add `supportLoadScore = round(support / totalItems × 100)`
   and include it in the 4-week `trend` points.
2. Add `overallSupportLoad` (a total + per-team share) to `HealthCheckReport`.
3. Frontend: a "Support Load" column showing `X% (n of m)` + sparkline, styled as muted
   context (not RAG-coloured), with a tooltip explaining it is not part of the health score
   because support demand is not team-controlled.

### Caveat

Support classification quality depends entirely on the per-board config
(`supportEpics` / `supportLabels` / `supportLinkTypes`). If those are not well maintained,
the metric measures Jira hygiene as much as real support load — so validate the config per
board before making this a reported KPI.

This would be a genuine feature (new response fields + UI) and should go through the
`create-feature` cycle (feature doc → proposal → implementation).
