# 0086 — Remove CloudFront WAF IP-allowlist; SSO is the sole access control

**Date:** 2026-08-11
**Status:** Accepted
**Deciders:** Architect Agent, Developer Agent, Infosec Agent
**Proposal:** docs/proposals/0081-remove-waf-sso-sole-control.md

## Context

ADR 0068 shipped Google Workspace SSO as application-level authentication and intended to
remove the CloudFront WAF IP-allowlist (ADR 0034). That removal was reversed at the time
because the `terraform apply` destroying the WebACL failed with `WAFAssociatedItemException`
while the WebACL was still associated with the CloudFront distributions. The WAF stayed in
place as defense-in-depth and ADR 0034 remained `Accepted`. ADR 0068's amendment anticipated
a future removal and mandated a two-apply sequence.

The team now removes the VPN requirement so the dashboard is reachable off-VPN, gated by SSO
alone. The removal was begun via console (detaching the WebACL from both distributions and
deleting its `AllowVPN` rule); this decision codifies that end state in Terraform so it is not
reverted on the next apply.

## Options Considered

### Option A — Keep the WAF as defense-in-depth (status quo)
- **Cons:** Retains the VPN requirement the team wants gone; console drift would be silently
  reverted on next apply.

### Option B — Remove the WAF; SSO becomes the sole access control **(chosen)**
- **Pros:** Off-VPN access; matches ADR 0068's original intent; single, well-understood control.
- **Cons:** No network gate behind the application; an auth defect would expose the app publicly.

### Option C — Replace the WAF with a different network control (e.g. managed prefix list)
- **Cons:** Reintroduces network-level allowlisting the team is deliberately dropping; more moving parts.

## Decision

Remove the CloudFront WAF IP-allowlist. **Google SSO (JWT session cookie, domain-restricted,
fail-closed at startup) is the sole access control.** The removal is executed as two Terraform
applies per ADR 0068's amendment:

1. Make `web_acl_arn` nullable in the `cdn` module and pass `null` from the prod environment
   (detach in state; no-op on CloudFront since the console already detached it), let propagate.
2. Remove the `waf` module and destroy the `aws_wafv2_web_acl.main` and
   `aws_wafv2_ip_set.allowed` resources.

Safety rests on the SSO implementation being fail-closed: the backend refuses to start without
`GOOGLE_ALLOWED_DOMAIN`, a non-default `SESSION_SECRET`, and `GOOGLE_CLIENT_ID`; a global
default-deny `AuthenticatedGuard` protects every route; `@Public()` is limited to
`POST /api/auth/google`, `POST /api/auth/logout`, and `GET /health`; and login is restricted to
the org domain via the token `hd` claim.

This **supersedes [0034](0034-cloudfront-waf-ip-allowlist.md)**.

## Consequences

- **Positive:** Remote access without VPN; a single access-control layer to reason about;
  aligns deployed infra with ADR 0068's original intent; removes the console/Terraform drift.
- **Negative / trade-offs:** The application is publicly reachable with authentication as the
  only gate — an auth defect has no network backstop. Data classification unchanged from ADR
  0068 (User entity = internal PII).
- **Risks:** Auth bug → public exposure (mitigated by fail-closed startup, global default-deny
  guard, narrow `@Public()` set); leaked `SESSION_SECRET` → JWT forgery (mitigated by Secrets
  Manager + non-default startup check). **Rollback:** re-add the `waf` module and `web_acl_arn`
  wiring from git history and apply.

## Related Decisions

- **Supersedes [0034](0034-cloudfront-waf-ip-allowlist.md)** — WAF IP-allowlist removed.
- **Amends [0068](0068-google-sso-replaces-waf.md)** — the WAF removal its amendment
  anticipated has now been carried out.
- **Builds on [0020](0020-no-application-level-authentication.md)** (already superseded by 0068).
