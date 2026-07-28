# 0069 — Remove Custom Reports; API-Key Authentication for Programmatic Access

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Infosec Agent
**Proposal:** docs/proposals/0075-remove-custom-reports-and-api-key-auth.md

## Context

The Custom Reports feature (ADRs 0057–0059) is no longer wanted — a large surface (backend
domain, 4 entities/tables, 15 frontend files, 13 MCP tools) with no ongoing value. Separately,
the Google SSO work (ADR 0068) placed a session-cookie guard on every API endpoint, which
broke the MCP server (it has no browser session) and left no non-public way for programmatic
clients to read the API now that the WAF is gone.

## Options Considered

### Option A — Make read endpoints fully public (`@Public()`)
- **Cons:** With the WAF removed, exposes all engineering metrics to anyone who can reach the URL. Rejected by stakeholder.

### Option B — Single shared static API key
- **Cons:** No per-user attribution, no independent revocation, rotation breaks all clients at once.

### Option C — Per-user API keys (chosen)
- **Summary:** Logged-in users mint personal keys; the global guard accepts a session cookie OR an `Authorization: Bearer <key>`; keys inherit the owner's role; only the SHA-256 hash is stored.
- **Pros:** Per-user attribution + revocation; no public exposure; MCP works via its existing `API_KEY` env var; hash-only storage; key management is session-only so a key cannot mint keys.
- **Cons:** A bearer key is a standing credential with no second factor (mitigated by hash-only storage, revocation, live role lookup).

## Decision

We will **remove the Custom Reports feature entirely** (code + data; a forward migration drops
the four `custom_report*` tables) and add **per-user API-key authentication**. A new `ApiKey`
entity stores only the SHA-256 hash of each key; the raw key (`frg_<base64url>`) is shown once
at creation. The global `AuthenticatedGuard` authenticates a request via **either** a valid
Google SSO session cookie **or** a valid `Authorization: Bearer <key>`, populating `req.authUser`
with the owning user's `{ sub, email, name, role }` (role looked up live). `AdminGuard` continues
to gate admin routes. Key-management endpoints (`POST/GET/DELETE /api/keys`) are `@SessionOnly()`
— a key cannot mint or enumerate keys. The MCP server is made **structurally read-only** (the
write HTTP helpers are removed from its client) and authenticates with a user's key via its
existing `API_KEY` env var.

This **supersedes ADR 0057, ADR 0058, and ADR 0059** (custom reports) and **extends ADR 0068**
(auth guard now also accepts API keys).

## Rationale

Per-user keys (Option C) give attribution and self-service revocation without exposing the API
publicly (Option A) or coupling all clients to one secret (Option B). Hash-only, show-once
storage is the standard secure pattern — a DB leak never yields usable keys. Making key
management session-only closes the key-minting-keys escalation. Removing the MCP write helpers
makes the read-only guarantee structural rather than convention.

## Consequences

- **Positive:** MCP (and any client) can read the API with an attributable, revocable key; no
  public exposure; smaller codebase after custom-reports removal; MCP cannot mutate anything.
- **Negative / trade-offs:** Custom-report data is permanently dropped (migration `down` recreates
  empty tables only). A bearer key grants the owner's access with no second factor until revoked.
- **Risks:** A leaked key is usable until revoked (mitigated by revocation + live role lookup +
  hash-only storage); if a `SESSION_SECRET`/key-store compromise occurred, keys would need mass
  revocation (delete rows). Revisit with key expiry/rotation if the threat model tightens.

## Related Decisions

- **Supersedes [0057](0057-custom-reports.md), [0058](0058-custom-report-widget-rename-and-new-kinds.md), [0059](0059-custom-report-layout-schema.md)** — custom reports removed.
- **Extends [0068](0068-google-sso-replaces-waf.md)** — the auth guard now also accepts API keys.
