# 0068 — Google SSO Authentication Replaces WAF IP-Allowlist

**Date:** 2026-07-28
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Infosec Agent
**Proposal:** docs/proposals/0074-google-sso-authentication.md

## Context

The app had no application-level authentication (ADR 0020) — access was gated solely by a
CloudFront WAF IP-allowlist (ADR 0034). This prevented remote access without VPN, offered
no per-user audit trail, and couldn't restrict sensitive operations to administrators.
Google Workspace SSO was chosen because the team already authenticates via it.

## Options Considered

### Option A — Google Workspace SSO + server-side sessions + role-based guards
- **Summary:** Passport.js + express-session + Postgres session store; `User` entity with admin/user roles; global auth guard; WAF removed.
- **Pros:** Simple, secure, no JWT complexity, role-based admin control, audit via lastLoginAt, domain-restricted.
- **Cons:** Session is server-stateful (DB dependent); data classification changes (email/name = internal PII).

### Option B — JWT stateless auth
- **Cons:** Refresh rotation complexity; token revocation non-trivial; unnecessary for server-rendered app.

### Option C — Keep WAF + add auth (defense in depth)
- **Cons:** VPN requirement persists; explicitly rejected by stakeholder.

## Decision

We will authenticate users via Google Workspace SSO (Passport.js + passport-google-oauth20),
manage sessions server-side (express-session + connect-pg-simple in Postgres), enforce a
global `AuthenticatedGuard` on all API endpoints (with `@Public()` opt-out for `/health`,
`/api-docs`, `/api/auth/*`), gate administrative operations (Settings, sync, user management)
behind an `AdminGuard`, and **remove the CloudFront WAF IP-allowlist** — authentication
replaces it as the sole access control layer.

This **supersedes ADR 0020** (no application-level authentication) and **ADR 0034**
(WAF IP-allowlist as primary access control).

## Rationale

The WAF gate requires VPN, prevents flexible remote access, and provides no per-user
identity or authorization. Google Workspace SSO leverages existing identity, the `hd` claim
naturally restricts to the org domain, and server-side sessions avoid the complexity of JWT
management for a server-rendered internal tool. The first-login auto-admin pattern
bootstraps the admin role without manual DB intervention.

## Consequences

- **Positive:** Remote access without VPN; per-user accountability (lastLoginAt); admin vs user
  permissions; audit trail foundation; no more IP-allowlist maintenance.
- **Negative / trade-offs:** Data classification change (User entity = internal PII); app
  publicly reachable (auth is sole gate); session dependency on Postgres (same as existing
  app dependency); 7 new runtime dependencies.
- **Risks:** Auth bug exposes the app publicly (mitigated by domain restriction + rollback plan
  to re-apply WAF from git history); Google OAuth outage blocks new logins (mitigated by
  7-day session max-age for existing sessions).

## Related Decisions

- **Supersedes [0020](0020-no-application-level-authentication.md)** — auth reinstated.
- **Supersedes [0034](0034-cloudfront-waf-ip-allowlist.md)** — WAF removed.
