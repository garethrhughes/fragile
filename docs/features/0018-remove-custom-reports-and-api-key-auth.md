# 0018 — Remove Custom Reports & Add API-Key Authentication

**Date:** 2026-07-28
**Status:** Implemented
**Source:** Manual
**Related proposal:** docs/proposals/0075-remove-custom-reports-and-api-key-auth.md

## Summary

Two related changes:

1. **Remove the Custom Reports feature entirely** — its NestJS module, four TypeORM
   entities and database tables, all frontend pages/components/lib/store, its 13 MCP tools,
   and the associated proposals/ADRs/feature docs.
2. **Add API-key authentication** so programmatic clients (the MCP server) can reach the
   API without a browser session. Logged-in users generate their own API key in the app;
   the global auth guard accepts a valid session cookie **or** a valid `Authorization:
   Bearer <key>` API key. The MCP server is also made strictly read-only.

## Background / Motivation

**Custom Reports** is no longer wanted. It is a large, self-contained surface (backend
domain, 4 entities, 15 frontend files, 13 MCP tools) that adds maintenance cost for a
feature that will not be used. Removing it — including dropping its data — simplifies the
app.

**API keys:** the Google SSO work (feature 0017) put a session-cookie guard on every API
endpoint. The MCP server has no browser session, so it can no longer reach the API. Rather
than exposing endpoints publicly (no WAF now either), users will generate a personal API
key in the app and configure it in their MCP client (Claude Desktop / Cursor). The MCP
server is inherently read-only; removing its write HTTP helpers makes that guarantee
structural.

## Scope

**In scope**

*Custom Reports removal:*
- Delete `backend/src/custom-reports/` (module, controller, service, DTOs, layout schema, specs)
- Delete the 4 entities (`CustomReport`, `CustomReportWidget`, `CustomReportDataPoint`, `CustomReportFilter`) and remove their `entities/index.ts` exports and `app.module.ts` import
- New migration: drop `custom_report_filters`, `custom_report_data_points`, `custom_report_widgets`, `custom_reports` (`up`); recreate (`down`)
- Delete frontend `/reports` pages, `components/custom-reports/`, `lib/custom-report-filtering.ts`, `lib/report-layout.ts`, `store/custom-report-filters-store.ts`, and their tests; remove custom-report types/functions from `lib/api.ts`; remove the "Reports" sidebar nav entry
- Delete the 13 custom-report MCP tools + registration + tests
- Delete proposals 0056–0058, ADRs 0057–0059, features 0008–0010; update `docs/proposals/README.md`, `docs/decisions/README.md`, and `CLAUDE.md`

*MCP read-only:*
- Remove `apiPost`, `apiPut`, `apiPatch`, `apiDelete` from `apps/mcp/src/client.ts` (custom-reports was their only consumer). Only `apiGet` remains.

*API-key auth:*
- New `ApiKey` entity + migration: `id` (uuid), `userId` (FK → users), `name`, `keyHash` (SHA-256), `lastUsedAt`, `createdAt`, `revokedAt` (nullable)
- New `api-keys` module: `POST /api/keys` (create — returns raw key once), `GET /api/keys` (list caller's keys, metadata only), `DELETE /api/keys/:id` (revoke). These endpoints require a **session** (not key-auth) so keys cannot mint keys.
- Extend `AuthenticatedGuard` to accept a valid `Authorization: Bearer <key>` as an alternative to the session cookie: hash the presented key, look up a non-revoked `ApiKey`, load its user, populate `req.authUser` with the user's id/email/name/role. Update `lastUsedAt`.
- Key inherits the owner's role; `AdminGuard` continues to gate admin routes.
- Frontend: an "API Keys" section (in Settings or a dedicated account page) to create (raw key shown once, copyable), list, and revoke keys.
- MCP: send `API_KEY` as `Authorization: Bearer` (already implemented — verify/keep). Update MCP `README.md` + Claude Desktop / Cursor config examples to show `API_KEY` as required. Restore the `API_KEY` row in the root README MCP section.

**Out of scope**

- Per-key scopes/permissions beyond inheriting the owner's role (deferred)
- Key expiry / rotation policy (deferred — manual revoke only for v1)
- Rate limiting per key (deferred)
- Re-displaying a key after creation (by design — hash-only storage; shown once)

## Acceptance Criteria

- Custom-reports backend module, entities, DTOs, and all barrel/`app.module` references are removed; backend compiles.
- A new migration drops the 4 `custom_report*` tables in FK-safe order (`up`) and recreates them (`down`).
- Custom-reports frontend (pages, components, lib, store, `api.ts` types/functions, sidebar "Reports" entry) is removed; frontend compiles and tests pass.
- The 13 custom-report MCP tools are removed and unregistered; MCP builds and tests pass.
- `apps/mcp/src/client.ts` exposes only `apiGet` — no `apiPost/apiPut/apiPatch/apiDelete`.
- Given a valid non-revoked API key in `Authorization: Bearer`, a request to a guarded read endpoint succeeds (200) with no session cookie.
- Given a revoked or unknown key, the request returns 401.
- Given an API key owned by a `user`-role account, a request to an admin endpoint returns 403; a key owned by an `admin` succeeds.
- `POST /api/keys` returns the raw key exactly once; the DB stores only its SHA-256 hash. `GET /api/keys` never returns the raw key. `DELETE /api/keys/:id` marks it revoked (subsequent use → 401).
- The key-management endpoints require a session (a Bearer key cannot create or list keys).
- A logged-in user can create, view (metadata), copy-once, and revoke their own API keys in the UI.
- MCP `README.md` and the root README show `API_KEY` in the Claude/Cursor `env` config as required.
- No references to custom reports remain anywhere (grep-clean).
- New ADR documents API-key auth and the custom-reports removal (supersedes ADRs 0057–0059).

## Open Questions

None — resolved at intake:
- Key storage: SHA-256 hash only, shown once.
- Key scope: per-user, inherits the owner's role.
- Acceptance: all guarded endpoints accept session OR key; AdminGuard still applies.
- Transport: `Authorization: Bearer <key>`.

## Notes

- **Data drop is destructive:** the migration `up()` drops all custom-report data. `down()`
  recreates the empty tables (schema only — data is not recoverable). Call this out in the PR.
- **Key-minting protection:** the `/api/keys` endpoints must reject Bearer-key auth (session
  only), otherwise a leaked read key could mint fresh keys. The guard/route must enforce this.
- **`ApiKey.keyHash`** is a credential-adjacent field — never logged, never returned after
  creation. Data classification: the `users` + `api_keys` tables hold internal PII +
  credentials (hashed).
- **Custom-reports migrations 1777200000000 / 1777300000000 are NOT edited** (never edit
  applied migrations); the new drop migration is forward-only cleanup.
