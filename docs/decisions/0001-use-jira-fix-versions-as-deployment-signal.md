# 0001 — Use Jira Fix Versions as Primary Deployment Signal

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Project setup team
**Proposal:** N/A

## Context

Jira does not expose a native "deployment" concept, yet Deployment Frequency is a core
DORA metric. Fix versions with a `releaseDate` are the closest built-in proxy Jira
provides. Some boards do not consistently use fix versions, so a fallback mechanism is
required to avoid silent data gaps. The chosen signal must be deterministic and
reproducible so that syncing the same data twice produces identical results.

## Options Considered

### Option A — Fix version releaseDate as primary signal
- **Summary:** Treat a fix version's `releaseDate` as the deployment timestamp for all
  issues linked to that version
- **Pros:**
  - Explicit, intentional act by the team (releasing a version)
  - Provides a single timestamp per release batch rather than per-issue noise
  - `releaseDate` is surfaced cleanly in the Jira REST API
- **Cons:**
  - Requires teams to maintain fix versions and set release dates
  - Boards that don't use fix versions will have no deployments recorded without a fallback

### Option B — Issue transition to "Done/Released" status
- **Summary:** Record a deployment event each time an issue transitions to a configured
  done status
- **Pros:**
  - Works on every board regardless of fix version discipline
  - No additional Jira configuration required
- **Cons:**
  - Produces one deployment event per issue rather than per release, inflating frequency
  - Transition timestamps are less precise for batch releases
  - Requires per-board configuration of what counts as "done"

### Option C — Jira Deployments API (next-gen projects only)
- **Summary:** Use Jira's dedicated Deployments feature available in next-gen projects
- **Pros:**
  - First-class deployment concept in Jira
- **Cons:**
  - Only available in next-gen (team-managed) projects; not available in classic projects
  - Not universally applicable across the team's boards

## Decision

> We will use fix version `releaseDate` as the primary deployment signal, falling back
> to "moved to a configurable done-status transition" when no fix version is present on
> an issue.

## Rationale

Fix versions represent a deliberate, team-level release act and map cleanly onto the
DORA "deployment" concept. The fallback ensures boards without fix version discipline
still contribute data rather than silently showing zero deployments. Option C was ruled
out because the team uses classic Jira projects. The configurable done-status in the
fallback path (see ADR-0003) prevents hardcoding assumptions about workflow naming.

## Consequences

- **Positive:** Deployment frequency calculations are grounded in intentional release
  events; the fallback provides coverage for less-disciplined boards
- **Negative / trade-offs:** Teams must set `releaseDate` on fix versions for primary
  signal to work; inconsistent version hygiene produces incomplete data
- **Risks:** If a board switches from fix-version discipline to none (or vice versa),
  historical trend lines will show an apparent step-change in deployment frequency

## Related Decisions

- [ADR-0003](0003-per-board-configurable-rules-for-cfr-and-mttr.md) — BoardConfig stores
  the done-status names used by the fallback path
- [ADR-0002](0002-cache-jira-data-in-postgres.md) — Fix version data is cached in
  Postgres; deployment signals are derived at query time from cached data
