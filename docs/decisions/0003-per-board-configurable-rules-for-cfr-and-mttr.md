# 0003 — Per-Board Configurable Rules for CFR and MTTR Stored in BoardConfig

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Project setup team
**Proposal:** N/A

## Context

Change Failure Rate (CFR) and Mean Time to Restore (MTTR) require identifying which
issues represent incidents or failures. Different teams use different conventions:
some use a dedicated "Incident" issue type, others use labels like `bug` or `incident`,
and others use issue links (e.g. "is caused by"). A single global configuration would
produce incorrect metrics for boards that deviate from the default convention.
The dashboard must support heterogeneous teams without requiring code changes per board.

## Options Considered

### Option A — Per-board configuration stored in a `board_configs` DB table
- **Summary:** A `board_configs` table stores failure/incident identification rules
  keyed by board ID; an admin UI or seeded config allows per-board overrides
- **Pros:**
  - Correct metrics for all boards regardless of team conventions
  - New boards can be configured without code changes
  - Rules are inspectable and auditable in the database
  - Enables future UI-driven configuration
- **Cons:**
  - Requires initial setup effort for each board
  - Adds a configuration management surface that must be documented

### Option B — Global defaults only, no per-board overrides
- **Summary:** A single set of failure identification rules applied to all boards
- **Pros:**
  - Simpler implementation — no `board_configs` table required
  - No per-board setup burden
- **Cons:**
  - Produces incorrect metrics for any board that doesn't match the global default
  - Teams using non-standard issue types or labels are silently mis-measured
  - Not viable for a multi-team dashboard

### Option C — Per-board config in a YAML/JSON file in the repository
- **Summary:** Store board rules in a checked-in config file rather than the database
- **Pros:**
  - Config is version-controlled
- **Cons:**
  - Requires a code deployment to change any board's configuration
  - Config file and database can diverge; no single source of truth at runtime
  - Does not support a future UI-driven configuration flow

## Decision

> We will store `failureIssueTypes`, `failureLinkTypes`, `failureLabels`,
> `incidentIssueTypes`, and `recoveryStatusNames` per board in a `board_configs`
> database table, loaded at metric calculation time.

## Rationale

Per-board database configuration is the only option that produces correct metrics
across heterogeneous teams without requiring code changes. Option B is ruled out
because the team's boards are known to use different conventions. Option C is ruled
out because runtime config changes would require deployments and introduces a
file-vs-database consistency risk. Storing config in Postgres keeps it alongside
the cached Jira data and queryable by the same ORM.

## Consequences

- **Positive:** Accurate CFR and MTTR for all boards; new boards configurable at
  runtime; foundation for a future configuration UI
- **Negative / trade-offs:** Each board requires an explicit configuration record;
  unconfigured boards will fall back to global defaults (which may be inaccurate)
- **Risks:** If board configuration records are missing or misconfigured, metrics
  will silently use defaults; the UI should surface the active configuration so
  users can validate it

## Related Decisions

- [ADR-0001](0001-use-jira-fix-versions-as-deployment-signal.md) — Done-status names
  used by the deployment fallback path are also stored in BoardConfig
- [ADR-0005](0005-kanban-boards-excluded-from-planning-accuracy.md) — BoardConfig also
  identifies board type (Scrum vs Kanban) to enforce the planning accuracy exclusion
