# Project Rules — Core

**Version:** 2.0
**Last updated:** 2026-05-10

Single source of truth for the **language-agnostic** conventions enforced across these
skills. Every skill references the sections below by anchor (e.g.
`RULES.md#configuration--secrets`) rather than restating the rules locally.

If you need to override a rule for your project, do so in your `CLAUDE.md` and the
`## Project Context` block of the relevant skill — never weaken the rule here.

---

## Active Stack Overlay

These core rules are deliberately language-agnostic. Stack-specific conventions
(language idioms, framework rules, ORM rules, logging library, test runner) live in
**stack overlay** files under [`rules/`](rules/):

| Profile | Overlay |
|---|---|
| `typescript` | [`rules/typescript.md`](rules/typescript.md) — TypeScript + NestJS + Next.js + TypeORM + pino + Jest/Vitest |
| `dotnet` | [`rules/dotnet.md`](rules/dotnet.md) — C# + ASP.NET Core + EF Core + Serilog + xUnit |

Your project's `CLAUDE.md` pins the active overlay via the `## Active Skillset` line —
written automatically by `project-bootstrap` or `project-onboard`. When no overlay is
pinned (legacy projects), skills default to `typescript`.

Skills should always read the **core rules in this file** plus the **active overlay**.
When the same concern appears in both (e.g. *Configuration & Secrets*), the overlay's
stack-specific implementation refines the principle stated here.

---

## Configuration & Secrets

- **All environment configuration goes through a typed config service / module.** The
  exact mechanism is stack-specific (see your overlay).
- **Raw environment-variable access (`process.env`, `Environment.GetEnvironmentVariable`,
  `os.environ`, etc.) must never happen outside the config module's setup code.** Any
  other read is a violation.
- **No hardcoded external URLs, IDs, region names, or credentials** — always read from
  config.
- **No secrets in source control.** Production secrets come from a managed secrets
  store (AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, or equivalent).
  `.env` / `appsettings.{Environment}.json` files containing secrets are git-ignored;
  an `.env.example` (or equivalent template) is committed.
- **Lockfiles are committed and authoritative;** CI installs in frozen / locked mode.
  Exact lockfile and command are stack-specific (see your overlay).

---

## External HTTP Clients

- **Every external HTTP call has an explicit timeout.** Default 5s; override with
  documented justification.
- **Exponential backoff with jitter** on retryable failures (HTTP 429, 5xx, network
  errors). Bounded retry count — never unbounded.
- **One typed client per external service.** A single client class lives in its own
  module / service. Domain code never calls the raw HTTP API directly.
- All external responses are validated at the boundary before entering domain code.
  The validation library is stack-specific (see your overlay).

---

## Logging & Observability

- **Structured logging only** (JSON). Concrete logger and configuration are
  stack-specific (see your overlay).
- Every log line includes a correlation/request ID propagated from the request entry
  point.
- **Never log secrets, credentials, tokens, raw PII, or full request bodies.** Use
  redaction.
- Sensitive operations (auth, permission grants, data export, key rotation) emit an
  audit-log event.
- No raw stdout/console writes (`console.log`, `Console.WriteLine`, `print`, etc.) in
  production code paths.

---

## Infrastructure as Code (OpenTofu / Terraform)

These rules apply regardless of the application language.

- **Pinned provider versions** in `required_providers`. Lockfile committed.
- **Remote state** with locking (S3 + DynamoDB, or equivalent). No local state in
  shared environments.
- **Standard resource tags** on every taggable resource:
  `owner`, `env`, `service`, `cost-center`, `managed-by` (`managed-by=opentofu`).
- **No `*` action on `*` resource — ever.** No wildcard principals on trust policies.
- Admin-scope actions (`iam:*`, `kms:*`, `s3:*`, `*:Delete*`) must be resource-scoped
  and justified.
- Encryption at rest enabled on every data store (S3, RDS, EBS, DynamoDB, EFS, etc.).
- TLS in transit enforced (HTTPS-only listeners, `s3:x-amz-server-side-encryption`
  bucket policies, RDS `rds.force_ssl`, etc.).
- Public exposure (security groups `0.0.0.0/0`, public S3 buckets, public RDS) requires
  explicit justification in the proposal/ADR.
- Infrastructure changes go through `tofu plan` in CI and require human review.

---

## Testing

- **TDD: red → green → refactor.** Write the failing test first.
- Unit tests for pure logic. Integration tests for module boundaries (controller →
  service → repository). End-to-end tests for critical user flows.
- No tests committed in skipped / focused state (`.skip`, `.only`, `xit`, `xdescribe`,
  `[Fact(Skip = "…")]`, `@pytest.mark.skip` without a tracking issue, etc.).
- Mocks at boundaries only (HTTP, DB, filesystem). Do not mock the system under test.
- Concrete test runner, assertion library, and integration-test harness are
  stack-specific (see your overlay).

---

## Git & PRs

- Commit messages: imperative mood, ≤72 char subject, body explains *why*.
- One logical change per commit; one logical feature per PR.
- PRs include the proposal/ADR link, acceptance criteria checklist, and a summary of
  testing performed.
- CI must pass before merge: lint, typecheck/build, unit + integration tests,
  `tofu plan` for infra changes, dependency / SAST scan.
