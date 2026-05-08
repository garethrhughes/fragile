# Project Rules

**Version:** 1.0
**Last updated:** 2026-05-08

Single source of truth for the conventions enforced across these skills. Every skill
references the sections below by anchor (e.g. `RULES.md#typescript-conventions`) rather
than restating the rules locally. If you need to override a rule for your project, do so
in your `CLAUDE.md` and the `## Project Context` block of the relevant skill — never
weaken the rule here.

These rules assume the default opinionated stack: TypeScript + NestJS 11 + TypeORM +
PostgreSQL on the backend, TypeScript + Next.js (App Router) on the frontend, OpenTofu
on AWS for infrastructure, `pino` for logging, Jest + Vitest for tests, ISO27001 for
compliance.

---

## TypeScript Conventions

- **Strict mode everywhere.** No `any`, no implicit `any`, no implicit returns,
  `noUncheckedIndexedAccess` on, `exactOptionalPropertyTypes` on.
- **`as const` object literals + derived union types** — never `enum`.
- **Discriminated unions** over optional flags or boolean soup.
- **`readonly` by default** on properties, arrays, tuples, and parameters where mutation
  is not required.
- **No barrel files (`index.ts` re-exports)** at module boundaries unless there is a
  documented justification (e.g. published package public surface).
- Prefer **named exports**. Default exports only where a framework requires them
  (e.g. Next.js `page.tsx`).
- **No `as` type assertions** except for narrowing after a runtime check or when
  interoperating with untyped third-party APIs — and document why.

---

## Configuration & Secrets

- **All environment configuration goes through a typed config service.** On NestJS
  projects this is `ConfigService`; on Next.js projects this is a typed `config/` module
  that validates on startup with Zod.
- **`process.env` must never be accessed outside the config module's setup code.** Any
  other read of `process.env` is a violation.
- **No hardcoded external URLs, IDs, region names, or credentials** — always read from
  config.
- **No secrets in source control.** Production secrets come from AWS Secrets Manager
  (or equivalent). `.env` files are git-ignored; `.env.example` is committed.
- Lockfiles (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`) are committed and
  authoritative; CI installs with `--frozen-lockfile` (or equivalent).

---

## External HTTP Clients

- **Every external HTTP call has an explicit timeout.** Default 5s; override with
  documented justification.
- **Exponential backoff with jitter** on retryable failures (HTTP 429, 5xx, network
  errors). Bounded retry count — never unbounded.
- **One typed client per external service.** A single `[ServiceName]ClientService` lives
  in its own module. Domain services never call `fetch`/`axios` directly.
- All external responses are validated at the boundary (Zod or class-validator) before
  entering domain code.

---

## Frontend Rules (Next.js)

- **No `useEffect` for data fetching.** Use Server Components, route handlers, server
  actions, or React Query (when interactivity requires client-side fetching).
- **No business logic in page components.** Delegate to services or custom hooks.
- All API calls go through a typed client (e.g. `lib/api.ts`) — never raw `fetch` in
  components.
- No direct state mutation outside store actions (Zustand store actions, React Query
  mutations, etc.).
- Every async UI has explicit `loading` and `error` states.

---

## Backend Rules (NestJS)

- **Thin controllers.** Controllers parse, validate, and delegate. Business logic lives
  in services.
- DTOs validated with `class-validator` + `class-transformer` (or Zod) at the controller
  boundary.
- Repositories own all persistence. Services never construct SQL or call the ORM
  directly outside repositories.
- Guards / interceptors enforce auth and audit logging — never inline checks in handlers.

---

## Logging & Observability

- **Structured logging only** (JSON via `pino`). No `console.log` in production code
  paths.
- Every log line includes a correlation/request ID propagated from the request entry
  point.
- **Never log secrets, credentials, tokens, raw PII, or full request bodies.** Use
  redaction.
- Sensitive operations (auth, permission grants, data export, key rotation) emit an
  audit-log event.

---

## Infrastructure as Code (OpenTofu / Terraform)

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
- No tests committed in `.skip` / `.only` / `xit` / `xdescribe` state.
- Mocks at boundaries only (HTTP, DB, filesystem). Do not mock the system under test.

---

## Git & PRs

- Commit messages: imperative mood, ≤72 char subject, body explains *why*.
- One logical change per commit; one logical feature per PR.
- PRs include the proposal/ADR link, acceptance criteria checklist, and a summary of
  testing performed.
- CI must pass before merge: lint, typecheck, unit + integration tests, `tofu plan` for
  infra changes, `semgrep` / dependency audit.
