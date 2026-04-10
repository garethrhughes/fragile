# 0008 — Tailwind CSS v4 with CSS-First Configuration

**Date:** 2026-04-10
**Status:** Accepted
**Deciders:** Project setup team
**Proposal:** N/A

## Context

The frontend application uses Tailwind CSS for styling. Tailwind v4 introduced a
fundamentally different configuration model: theme and plugin configuration is now
expressed directly in CSS via `@theme` and `@plugin` directives in the global
stylesheet, replacing the `tailwind.config.js` (or `.ts`) JavaScript file used in
v3 and earlier. Using a `tailwind.config.js` file with Tailwind v4 causes build
errors and is not supported. The project must adopt the v4 configuration model
to avoid breakage as Tailwind v4 is the installed version.

## Options Considered

### Option A — CSS-first configuration via @theme in globals.css (v4 approach)
- **Summary:** Define all Tailwind theme customisations (colours, spacing, fonts, etc.)
  using `@theme { }` blocks inside `frontend/src/app/globals.css`; no
  `tailwind.config.js` file
- **Pros:**
  - Correct approach for Tailwind v4 — no build errors
  - All styling configuration colocated in CSS, not split across CSS and JS
  - Simpler mental model — one language for styling concerns
  - No JavaScript config file to maintain
- **Cons:**
  - Developers familiar with Tailwind v3 will need to learn the new config syntax
  - IDE support for `@theme` is less mature than for the JS config file
  - Some community plugins may not yet support v4's CSS-first approach

### Option B — Use tailwind.config.js (v3 approach)
- **Summary:** Maintain a `tailwind.config.js` alongside Tailwind v4
- **Pros:**
  - Familiar to most developers; extensive documentation and community examples
- **Cons:**
  - Incompatible with Tailwind v4 — causes build errors
  - Not a viable option with the installed Tailwind version

### Option C — Downgrade to Tailwind v3
- **Summary:** Pin Tailwind to the latest v3 release to use the familiar JS config model
- **Pros:**
  - Well-understood; no config migration needed; broad plugin compatibility
- **Cons:**
  - v3 will eventually become unsupported; defers rather than resolves the migration
  - Misses v4 performance improvements (faster build via Oxide engine)
  - Locks the project to an older major version unnecessarily

## Decision

> We will configure Tailwind using `@theme` blocks in `frontend/src/app/globals.css`;
> no `tailwind.config.js` file will be present in the repository.

## Rationale

Tailwind v4 is already installed and the CSS-first approach is the only compatible
configuration model. Option B is non-functional and Option C trades a short-term
familiarity benefit for a long-term technical debt obligation. Adopting the v4 model
now keeps the project aligned with the Tailwind ecosystem's direction and benefits from
the Oxide engine's build-time improvements.

## Consequences

- **Positive:** Build works correctly with Tailwind v4; project is aligned with the
  current Tailwind ecosystem; no JS config file to keep in sync with CSS tokens
- **Negative / trade-offs:** Developers must learn `@theme` syntax; some v3-era
  documentation and community answers do not apply
- **Risks:** Third-party Tailwind plugins that rely on `tailwind.config.js` hooks may
  not be compatible with v4; plugin choices should be validated against v4 support
  before adoption

## Related Decisions

- [ADR-0007](0007-monorepo-backend-frontend-directories.md) — Tailwind configuration
  lives in the `frontend/` directory
