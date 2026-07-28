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

### Option A — Google Workspace SSO + server-side sessions (Passport)
- **Summary:** Passport.js + `passport-google-oauth20` + `express-session` + `connect-pg-simple` Postgres session store.
- **Pros:** Familiar NestJS pattern; server-side session revocation possible.
- **Cons:** Heavy (7 deps); `express-session` proved fragile in practice (crash on `session.cookie` for unauthenticated requests); a server-side session store is unnecessary for a small internal tool.

### Option B — Google Workspace SSO + stateless JWT cookie **(chosen)**
- **Summary:** `@react-oauth/google` (Google Identity Services) obtains an ID token client-side; `google-auth-library` verifies it server-side; a self-contained JWT is signed with `jsonwebtoken` and stored in an `httpOnly` cookie. No session store.
- **Pros:** Minimal (3 backend deps); no session table; no per-request DB lookup; verifies against client ID only (no client secret); simpler and more robust than express-session.
- **Cons:** Stateless — a role change takes effect on next login rather than immediately (acceptable per the feature's out-of-scope note); token revocation would require a denylist if ever needed.

### Option C — Keep WAF + add auth (defense in depth)
- **Cons:** VPN requirement persists; explicitly rejected by stakeholder.

## Decision

We authenticate users via Google Workspace SSO using the **Google Identity Services
ID-token flow** (`@react-oauth/google` frontend → `google-auth-library` backend
verification). A self-contained **JWT is signed and stored in an `httpOnly`, `secure`,
`sameSite=lax` cookie** (`jsonwebtoken`); there is **no server-side session store**. A
global `AuthenticatedGuard` verifies the JWT cookie on every request (with `@Public()`
opt-out for `/health`, `/api-docs`, `/api/auth/*`); an `AdminGuard` gates administrative
operations (Settings, sync, user management). Login is restricted to `GOOGLE_ALLOWED_DOMAIN`
via the token's `hd` claim, enforced **fail-closed** (the backend refuses to start if the
domain, `SESSION_SECRET`, or `GOOGLE_CLIENT_ID` are unset). The first user to log in is
auto-promoted to admin. The **CloudFront WAF IP-allowlist is removed** — authentication
replaces it as the sole access control layer.

This **supersedes ADR 0020** (no application-level authentication) and **ADR 0034**
(WAF IP-allowlist as primary access control).

> **Note:** Option A (Passport + express-session) was initially selected and is what the
> accepted proposal 0074 described. It was abandoned mid-implementation for the reasons in
> its Cons above and replaced with Option B, which the proposal had listed as an
> alternative. This ADR records the design that actually shipped.

## Rationale

The WAF gate requires VPN, prevents flexible remote access, and provides no per-user
identity or authorization. Google Workspace SSO leverages existing identity, and the `hd`
claim naturally restricts to the org domain. A stateless JWT cookie (Option B) was chosen
over server-side sessions (Option A) because `express-session` proved fragile and a session
store adds operational weight with no benefit for this tool's needs — the JWT is verified
per request without a DB round-trip. The first-login auto-admin pattern bootstraps the admin
role without manual DB intervention. Because the WAF is removed in the same change, the
domain check and secret are enforced fail-closed at startup so a misconfiguration can never
silently open the app.

## Consequences

- **Positive:** Remote access without VPN; per-user accountability (lastLoginAt); admin vs user
  permissions; no session table or store to operate; no per-request DB lookup for auth;
  minimal dependency footprint (3 backend + 1 frontend).
- **Negative / trade-offs:** Data classification change (User entity = internal PII); app
  publicly reachable (auth is the sole gate); stateless tokens mean a role change or "logout
  everywhere" is not instantaneous (takes effect at next login / token expiry).
- **Risks:** Auth bug exposes the app publicly (mitigated by fail-closed domain + secret
  validation at startup, and a rollback plan to re-apply the WAF from git history); a leaked
  `SESSION_SECRET` would allow token forgery (mitigated by Secrets Manager storage and the
  non-default-value startup check); Google outage blocks new logins (existing cookies valid
  until expiry).

## Related Decisions

- **Supersedes [0020](0020-no-application-level-authentication.md)** — auth reinstated.
- **Supersedes [0034](0034-cloudfront-waf-ip-allowlist.md)** — WAF removed.
