# 0007 — Monorepo with backend/ and frontend/ Directories

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Project setup team
**Proposal:** N/A

## Context

The project requires a backend API (NestJS) and a frontend web application (Next.js)
to be developed and deployed together. A monorepo structure keeps both in a single
repository for unified version control, shared CI pipelines, and coordinated
dependency management. The original project brief specified `apps/api` and `apps/web`
as the directory layout (following a common Nx/Turborepo convention), but the actual
implementation was scaffolded using `backend/` and `frontend/` at the repository root.
This decision records the actual structure to avoid confusion between the brief and
the codebase.

## Options Considered

### Option A — backend/ and frontend/ at repo root (actual implementation)
- **Summary:** Two top-level directories, `backend/` (NestJS) and `frontend/` (Next.js),
  each with their own `package.json` and tooling
- **Pros:**
  - Self-describing directory names — purpose is immediately obvious
  - No monorepo tooling (Nx, Turborepo) required to understand or build the project
  - Straightforward Docker and CI configuration (each directory is an independent build context)
  - Matches the actual scaffolded state of the repository
- **Cons:**
  - Diverges from the `apps/api` + `apps/web` convention described in the original brief
  - Some agent instructions and documentation may reference the old paths

### Option B — apps/api and apps/web (original brief convention)
- **Summary:** Follow the Nx/Turborepo-style `apps/` prefix as described in the project brief
- **Pros:**
  - Consistent with the brief; familiar to developers experienced with Nx/Turborepo
  - The `apps/` prefix scales naturally if packages or libs are added later
- **Cons:**
  - Does not match the actual scaffolded directory structure
  - Migrating the existing `backend/` and `frontend/` directories would be disruptive
    with no material benefit

### Option C — Single package.json at root (integrated monorepo)
- **Summary:** Both backend and frontend share a single root `package.json` with
  workspaces
- **Pros:**
  - Shared `node_modules`; easier cross-project imports
- **Cons:**
  - Backend (NestJS) and frontend (Next.js) have divergent dependency graphs and build
    toolchains; sharing creates conflicts
  - Deployment must still separate backend from frontend

## Decision

> We will use `backend/` and `frontend/` as the top-level project directories in the
> monorepo; all agent instructions, CI configuration, and documentation must reference
> these paths, not `apps/api` or `apps/web`.

## Rationale

The repository was scaffolded with `backend/` and `frontend/` and there is no
functional advantage to renaming them to match the original brief's convention.
Updating documentation and agent instructions to reflect reality is lower cost and
lower risk than migrating the directory structure. The `backend/`/`frontend/` naming is
unambiguous and requires no knowledge of Nx/Turborepo conventions.

## Consequences

- **Positive:** All documentation and tooling accurately reflects the actual codebase;
  no risk of developer confusion from mismatched paths
- **Negative / trade-offs:** The original project brief is now inconsistent with the
  implementation; any future onboarding material derived from the brief must be
  corrected
- **Risks:** Agent instructions or CI templates that still reference `apps/api` or
  `apps/web` will silently fail; all such references should be audited

## Related Decisions

- [ADR-0004](0004-single-user-api-key-auth.md) — Auth strategy is implemented in
  `backend/`; the `frontend/` reads the API key from its environment
- [ADR-0008](0008-tailwind-css-v4-css-first-configuration.md) — Tailwind configuration
  lives in `frontend/`
