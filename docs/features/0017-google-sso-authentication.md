# 0017 — Google SSO Authentication & Role-Based Access Control

**Date:** 2026-07-28
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0074-google-sso-authentication.md

## Summary

Add Google Workspace SSO login as the application-level authentication mechanism, with a
`User` entity tracking all logged-in users and a two-tier role model (`user`/`admin`).
Admin role is required for the Settings section and sync trigger; all other views are
read-only for authenticated users. The first person to log in is auto-promoted to admin
when no admin exists. The existing CloudFront WAF IP-allowlist is removed — authentication
replaces it as the access control layer.

## Background / Motivation

The app currently has no application-level authentication (ADR 0020) — access control
relies entirely on a CloudFront WAF IP-allowlist (VPN requirement, ADR 0034). This is
limiting: remote access requires VPN, there's no audit trail of who accessed what, no
per-user permissions, and no way to restrict sensitive operations (like board config
changes or sync triggers) to a subset of users.

Google Workspace SSO is the natural fit: the team already authenticates via Google
Workspace (`mypassglobal.com`), so there's no password management or new identity provider
to set up. The VPN/WAF requirement becomes unnecessary once auth is in place.

## Scope

**In scope**

- Google OAuth2 login via Passport.js (`@nestjs/passport` + `passport-google-oauth20`)
- Server-side sessions via `express-session` + `connect-pg-simple` (session stored in Postgres)
- Domain restriction: only `@mypassglobal.com` (configurable via `GOOGLE_ALLOWED_DOMAIN`)
- New `User` entity: id (uuid), email, name, avatarUrl, role (`user`|`admin`), lastLoginAt, createdAt
- Auth guard on all API endpoints; unguarded: `/health`, `/api-docs`, `/api/auth/*`
- Admin guard on: `PUT /api/boards/:id/config`, `POST /api/sync`, user-management endpoints
- Auto-admin: first user to log in becomes admin if no admin exists
- Settings page: user list (email, name, role, last login); admin can change roles
- Frontend: Next.js middleware protects all routes (redirects to `/login` if no session cookie); Settings nav item hidden for non-admins
- Login page with "Sign in with Google" button
- Logout endpoint + button in UI header
- Remove CloudFront WAF IP-allowlist from Terraform (auth replaces it as access control)
- New secrets in AWS Secrets Manager: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Supersede ADR 0020

**Out of scope**

- Fine-grained permissions beyond `user`/`admin` (e.g. per-board access) — may be added later
- MFA (Google handles this at the IdP level; not at our application layer)
- User deletion/deactivation (deferred — role change is sufficient for v1)
- Audit logging of auth events beyond the `lastLoginAt` field (a gap to address later)
- Session invalidation on role change (deferred — admin can revoke by changing role; next login picks up the change)

## Acceptance Criteria

- Given an unauthenticated user, when they visit any page, they are redirected to Google SSO login.
- Given a user with a valid `@mypassglobal.com` Google account, when they complete SSO, they are logged in and can access all read-only views.
- Given a user outside the allowed domain, when they attempt SSO, they are denied access with an appropriate error.
- Given the first user to log in and no admin exists in the DB, that user is automatically set to role `admin`.
- Given a subsequent user logging in for the first time, they are created with role `user`.
- Given an admin on the Settings page, they see the full settings section (board config, user list, role management) and can trigger a sync.
- Given a non-admin user, the Settings nav item is hidden; direct navigation to `/settings` is blocked; `PUT /api/boards/:id/config`, `POST /api/sync`, and user-management endpoints return 403.
- The CloudFront WAF IP-allowlist is removed from Terraform; the app is accessible via CloudFront without VPN once authenticated.
- All API endpoints (except `/health`, `/api-docs`, and `/api/auth/*`) require a valid session; unauthenticated requests receive 401.
- ADR 0020 ("no application-level authentication") is superseded.

## Open Questions

None — resolved at intake:
- Sessions: server-side (express-session + Postgres).
- OAuth library: Passport.js via @nestjs/passport.
- Frontend auth: Next.js middleware.
- WAF removal: same PR.
- Domain: `mypassglobal.com` via `GOOGLE_ALLOWED_DOMAIN` env var.
- Admin gate: Settings section + sync trigger.

## Notes

- **Data classification change:** The new `User` entity stores email and name (internal PII from Google Workspace). This changes the project's data classification from "no PII" to "internal PII (employee identity)."
- **New dependencies required:** `@nestjs/passport`, `passport`, `passport-google-oauth20`, `express-session`, `connect-pg-simple`, `@types/passport-google-oauth20`, `@types/express-session`.
- **New secrets:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` stored in AWS Secrets Manager, accessed via `ConfigService` (never hardcoded).
- **Supersedes ADR 0020** — this must be the first time since the project's inception that auth is reinstated at the application layer; the ADR should clearly document why the situation changed.
- **Session table:** `connect-pg-simple` creates its own `session` table; the migration should set this up or rely on the library's auto-create.
- **Infra blast radius:** removing the WAF IP-allowlist means the app is publicly accessible (via CloudFront) to anyone who can reach the URL. Auth is now the sole access gate — this is intentional but must be flagged in the infosec review.
