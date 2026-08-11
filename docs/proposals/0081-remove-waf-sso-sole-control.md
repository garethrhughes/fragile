# 0081 — Remove CloudFront WAF IP-allowlist; SSO becomes the sole access control

**Date:** 2026-08-11
**Status:** Proposed
**Author:** Architect Agent
**Related ADRs:** 0086 (proposed); supersedes 0034; amends 0068
**Builds on:** ADR 0068 (Google SSO authentication) and its 2026-07-28 amendment

## Problem Statement

ADR 0068 introduced Google Workspace SSO as application-level authentication and *intended*
to remove the CloudFront WAF IP-allowlist (VPN requirement, ADR 0034) in the same change.
That removal did **not** land: the `terraform apply` that would have destroyed the WebACL
failed with `WAFAssociatedItemException` because the WebACL was still associated with the
two CloudFront distributions. The WAF was restored and left in place as defense-in-depth,
and ADR 0034 remained `Accepted`. ADR 0068's amendment explicitly anticipated a future
removal, requiring it be done as **two applies** (first drop `web_acl_id` from the
distributions and let it propagate, then destroy the WebACL) to avoid that association error.

The team now wants to remove the VPN requirement so the dashboard is reachable without VPN,
gated by SSO alone. This removal was **started manually in the console** (drift): the WebACL
was detached from both distributions and its `AllowVPN` rule deleted. Terraform still declares
the WAF, so the next `terraform apply` would revert the change (re-associate the WebACL and
restore the rule) — the opposite of intent. The drift must be codified, not reverted.

## Security Basis

Removing the WAF makes SSO the **sole** control between the public internet and all
Jira-mirrored data plus the admin/sync endpoints. This is acceptable only because the SSO
implementation is genuinely fail-closed (verified in code):

- **Fail-closed startup** (`backend/src/auth/auth.service.ts`): the app refuses to boot if
  `GOOGLE_ALLOWED_DOMAIN`, `SESSION_SECRET` (or the default `change-me`), or
  `GOOGLE_CLIENT_ID` are unset. A misconfiguration cannot silently open the app.
- **Global default-deny guard** (`AuthenticatedGuard`, wired as `APP_GUARD`): every route
  requires a valid SSO JWT cookie or a valid API-key Bearer token; unauthenticated requests
  throw `UnauthorizedException`.
- **`@Public()` opt-out is limited to three safe routes**: `POST /api/auth/google`,
  `POST /api/auth/logout`, `GET /health`. No data or admin route is public.
- **Domain restriction fail-closed**: login is rejected unless the Google token's `hd` claim
  matches `GOOGLE_ALLOWED_DOMAIN`.
- **Admin operations** (Settings, sync, user management) are additionally gated by `AdminGuard`.

## Proposed Solution

### Terraform — two-apply WAF removal (per ADR 0068 amendment)

The console change has already removed the live associations, so apply 1 is a no-op on
CloudFront and only aligns state.

**Apply 1 — make the association optional and detach in state**
- `modules/cdn/variables.tf`: make `web_acl_arn` nullable with `default = null`.
- `modules/cdn/main.tf`: `web_acl_id = var.web_acl_arn` already accepts `null` (CloudFront
  treats `null` as "no WebACL").
- `environments/prod/main.tf`: pass `web_acl_arn = null` to the `cdn` module (stop wiring
  `module.waf.web_acl_arn`).
- Apply. Because the distributions are already detached in reality, this is a state-only
  reconciliation; let CloudFront propagate.

**Apply 2 — destroy the WebACL and IP set**
- `environments/prod/main.tf`: remove the `module "waf"` block and its `us_east_1` provider
  wiring.
- Delete `modules/waf/` (or leave the module dir unused; the environment no longer calls it).
- Apply. Destroys `aws_wafv2_web_acl.main` and `aws_wafv2_ip_set.allowed`.

Splitting the applies avoids re-triggering `WAFAssociatedItemException`.

### Governance
- ADR 0086 records the decision and **supersedes ADR 0034**; ADR 0068's amendment is updated
  to note the removal it anticipated has now occurred.
- Infosec review required before apply (removes a security control; SSO becomes sole gate).

### Out of scope
- No application code changes — SSO auth already shipped under ADR 0068.
- No change to the `@Public()` route set.

## Acceptance Criteria

1. `terraform plan` shows the two CloudFront distributions with `web_acl_id` unset (not being
   re-added) and, after apply 2, the `aws_wafv2_web_acl.main` and `aws_wafv2_ip_set.allowed`
   resources destroyed.
2. No `terraform apply` re-associates the WebACL or restores the `AllowVPN` rule.
3. The dashboard is reachable without VPN and returns `401` to unauthenticated requests on all
   non-`@Public()` routes.
4. ADR 0086 created; ADR 0034 marked `Superseded by 0086`; ADR 0068 amendment updated.
5. Infosec sign-off recorded.

## Risks & Mitigations

- **Auth bug now exposes the app publicly** (no network gate behind it). Mitigated by
  fail-closed startup validation, global default-deny guard, and the narrow `@Public()` set.
- **Leaked `SESSION_SECRET` allows JWT forgery.** Mitigated by Secrets Manager storage and the
  non-default-value startup check.
- **Confirm `/api-docs` (Swagger) is behind the guard** — it is not in the `@Public()` set, but
  verify Swagger is mounted inside the guard pipeline before apply (review item).
- **Rollback:** re-add the `waf` module and `web_acl_arn` wiring from git history and apply;
  the WebACL definition is preserved in version control.
