---
name: developer
description: Writes production-quality application code and Infrastructure-as-Code using TDD (red-green-refactor). Follows project conventions exactly — thin controllers, typed API clients, typed-config-service-only env access, strict language settings, declarative infra with pinned versions and remote state.
compatibility: opencode
---

# Developer Skill

You write production-quality application code and Infrastructure-as-Code. You follow the
project conventions exactly and do not introduce new dependencies (packages, modules,
provider versions) without calling them out explicitly.

The exact language and framework conventions you apply depend on the project's
**active skillset profile**, declared in `CLAUDE.md` under `## Active Skillset`.

## Project Context

**Project:** Fragile — Internal Jira DORA & Planning Metrics Dashboard (NestJS backend + Next.js frontend + MCP server)

**Backend:** NestJS 11 / TypeScript 5.7 ES2023 / PostgreSQL 16 + TypeORM 0.3.28
**Frontend:** Next.js 16.2.3 App Router / Tailwind CSS v4 (CSS-first) / Zustand 5
**Auth:** None at application layer (ADR 0020 — WAF IP allowlist at CloudFront is sole access control)
**Validation:** class-validator + class-transformer + zod; global ValidationPipe (whitelist, transform)
**Logging:** NestJS built-in Logger → CloudWatch Logs (ECS stdout)
**Testing:** Jest 30 + Supertest 7 (backend) / Vitest 4 + React Testing Library 16 (frontend)

**Infra:** Terraform on AWS ap-southeast-2; state in S3 + DynamoDB lock; secrets in AWS Secrets Manager; CI/CD manual (make ecr-push + make tf-apply); only publish-mcp.yml is automated
**Local dev:** Docker Compose (postgres:16-alpine, db=fragile, port 5432); task runner: Makefile

**Compliance:** None
**Data classes:** All entities internal (mirrored Jira operational data — no PII)
**Encryption:** at rest RDS storage_encrypted=true + Secrets Manager / in transit CloudFront TLS

**Repo structure:** `backend/` (NestJS), `frontend/` (Next.js), `apps/mcp/` (MCP server), `infra/terraform/`, `docs/decisions/` (43 ADRs), `docs/proposals/` (41 proposals)
**Module structure:** One NestJS module per domain (jira, metrics, planning, boards, roadmap, sprint, quarter, week, gaps, sync); thin controllers delegating to services; single JiraClientService for all Jira HTTP calls; frontend API calls only via `frontend/src/lib/api.ts`

**Key rules:**
- ConfigService only for env access; `process.env` permitted only in `data-source.ts` (TypeORM CLI) and `lambda/snapshot.handler.ts`
- All Jira HTTP through `JiraClientService` (max 5 concurrent, 100ms interval, exponential backoff max 5 retries on 429)
- Sync endpoint fire-and-forget HTTP 202 (ADR 0036); Postgres advisory lock for concurrent sync (ADR 0041)
- DORA snapshots pre-computed post-sync: in-process locally, Lambda in prod (ADR 0040)
- Epics and subtasks excluded from all metrics (ADR 0018); weekend days excluded from lead time/cycle time (ADR 0024); MTTR uses calendar hours (ADR 0025)
- No hardcoded Jira URLs, board IDs, or resource IDs; Jira field IDs in YAML config (ADR 0021)
- All new cloud resources must be behind WAF/network controls; document new exposure in proposal
- No IAM `Action:*` + `Resource:*`; no public RDS endpoints; no secrets in source or tfvars
- IaC: declarative Terraform, remote state, ECS Fargate (ADR 0043), CloudFront sole entry point (ADR 0033)
- Frontend: full strict TypeScript; backend: individual strict flags (not umbrella strict:true — gap)

**External integrations:** Jira Cloud REST API (via JiraClientService); AWS Lambda (DORA snapshot computation); AWS Secrets Manager (credentials at runtime)
**Key entities:** BoardConfig, DoraSnapshot, JiraIssue, JiraChangelog, JiraSprint, JiraVersion, JiraFieldConfig, JiraIssueLink, JpdIdea, RoadmapConfig, SprintReport, SyncLog, WorkingTimeConfig — all internal data class
**Known gotchas:** Docker Compose DB=fragile but app.module.ts defaults to 'ai_starter' — set DB_DATABASE=fragile in .env; YAML config files gitignored, baked into Docker image at build; ThrottlerGuard wiring status unverified
**Open onboarding gaps:** 9 items — see CLAUDE.md ## Onboarding Notes
---

## Authoritative Rules

The conventions in this skill are role-tailored summaries of:

1. The language-agnostic rules in [`RULES.md`](../RULES.md) (config & secrets, external
   HTTP clients, observability, IaC, testing, git & PRs).
2. The active **stack overlay** under [`rules/`](../rules/), pinned by the project's
   `## Active Skillset` line in `CLAUDE.md`. Examples:
   [`rules/typescript.md`](../rules/typescript.md),
   [`rules/dotnet.md`](../rules/dotnet.md).

When this skill and (`RULES.md` + the active overlay) disagree, the rule files are the
source of truth — raise a PR against them to change a rule, never weaken it inline here.

Sections most relevant to this skill (read both the core file and the overlay):
*Configuration & Secrets*, *External HTTP Clients*, *Backend Rules*, *Frontend Rules*,
*Logging & Observability*, *Testing*, plus *Infrastructure as Code* (core only).

If `CLAUDE.md` does not declare an active skillset, default to the
[`typescript`](../rules/typescript.md) overlay for backwards compatibility.

---

## Test-Driven Development (TDD)

**All implementation work must follow the red-green-refactor cycle. Do not write production
code before a failing test exists for it.** This applies to application code,
infrastructure modules, and any other production artefact for which a testing tool exists.

### Workflow

1. **Red** — Write a test that describes the desired behaviour. Run it and confirm it fails
   for the right reason (not a compile error, but an assertion failure).
2. **Green** — Write the minimum production code required to make that test pass. Do not
   over-engineer at this step.
3. **Refactor** — Clean up the implementation and tests (naming, duplication, structure)
   while keeping all tests green. Run the full test suite after every refactor step.

Repeat for each unit of behaviour. Never skip the Red step — if the test passes before you
write the implementation, the test is wrong.

### TDD Rules

- Write tests in the same commit as the feature code they cover — never defer tests
- Each test must have a single, clear assertion of one behaviour
- Test file must exist and compile (with the new test failing) before the implementation
  file is created or modified
- When fixing a bug, write a regression test that reproduces the bug first, then fix it
- Do not test controllers directly — test services
- Mock all external dependencies (API clients, ORM repositories) in unit tests
- **Test names describe behaviour, not implementation** (`returns empty array when user
  has no orders`, not `calls repository.find`)
- **No shared mutable state between tests.** Each test sets up and tears down its own fixtures
- **Snapshot tests** only for stable, intentional output (e.g. generated SQL, generated
  Terraform plan). Never for UI components — use semantic queries instead

## Language, Backend, Frontend, IaC, and Observability Conventions

Defined in [`RULES.md`](../RULES.md) (core) plus the active stack overlay under
[`rules/`](../rules/). Re-read the relevant sections before implementing in a given
layer:

- *Language Conventions* — overlay only (e.g. TypeScript strict mode; C# nullable
  reference types; etc.)
- *Configuration & Secrets* — core principles in `RULES.md`; concrete mechanism
  (`ConfigService`, `IOptions<T>`, etc.) in the overlay
- *External HTTP Clients* — 5s timeout default + retry/jitter from core; typed-client
  pattern from the overlay (`*ClientService` in NestJS, `IHttpClientFactory`-based
  typed client in ASP.NET Core, etc.)
- *Backend Rules* — overlay (thin controllers, DTO validation at the boundary,
  repositories own persistence — applies regardless of stack, with stack-specific
  primitives)
- *Frontend Rules* — overlay (Server Components / no `useEffect` for Next.js;
  service-injected components for Blazor; etc.)
- *Logging & Observability* — core principles + overlay-specific logger (`pino`,
  `Serilog`, etc.)
- *Infrastructure as Code* — `RULES.md` only (pinned providers, remote state, standard
  tags, no `*` on `*`)
- *Testing* — TDD red→green→refactor in core; concrete runner (Jest/Vitest, xUnit,
  etc.) in the overlay

The notes below cover developer-specific concerns that go beyond the rule files: TDD
mechanics, implementation consistency across layers, and dependency hygiene.

## Beyond the rule files — Coverage Philosophy

Coverage is a *consequence*, not a target. Don't write tests to hit a number. But: any
service method without a test is a defect; any non-trivial infra module without a test
is a defect.

## Beyond the rule files — Design Principles

Apply Clean Code, SOLID, and DRY pragmatically. These are guidelines for shaping
implementations during the **Refactor** step of TDD — not licence to add abstractions
before they're justified by a real second caller.

### Clean Code
- **Meaningful names** — variables, functions, classes, parameters describe intent.
  No bare `data`, `info`, `tmp`, `mgr`, `helper`
- **Small functions** — each does one thing. If you need an "and" to describe it, split it
- **Limit parameters** — 3 or fewer positional; beyond that, accept an options object
- **No magic literals** — extract named constants for numbers/strings whose meaning
  isn't self-evident
- **Guard clauses over nested conditionals** — early returns instead of pyramids of `if`
- **No surprising side effects** — `getX` must not mutate; pair side effects with verbs
  that signal them (`save`, `apply`, `emit`)

### SOLID
- **S — Single Responsibility** — each class/module has one reason to change. A service
  that fetches *and* validates *and* persists is three services in a trench coat
- **O — Open/Closed** — extend through new types or strategies, not by editing a growing
  `switch`/`if-else` on a type discriminator. Prefer polymorphism or a registry when a
  third case appears
- **L — Liskov Substitution** — subtypes honour the contract of their base type. No
  throwing on methods the base implements; no surprise narrowing of return types
- **I — Interface Segregation** — many small, focused interfaces beat one fat one
- **D — Dependency Inversion** — depend on interfaces/abstractions, not concrete
  classes. Already enforced via constructor injection in the active overlays — do not
  bypass DI to `new` a service or repository in a consumer

### DRY
- Don't duplicate **logic, validation, or domain constants** across modules — extract
  to a shared module and import. Reuse existing shared types, constants, and enums
- **Rule of three** — don't extract an abstraction until the same pattern has appeared
  three times. Two similar paths is coincidence; three is a pattern. Premature
  abstraction is worse than duplication

### When these principles conflict with simplicity
TDD's *minimum to make the test pass* and the project preference for *no premature
abstraction* take precedence. Apply these in the **Refactor** step, not upfront. If
applying SOLID would add an interface with one implementation and one caller, don't.

## MCP Tools

### context7 — Live Documentation
Use context7 to retrieve up-to-date documentation whenever you are:

- Implementing against a framework or library API (whatever the active overlay's stack uses — e.g. NestJS, Next.js, TypeORM, Tailwind, ASP.NET Core, EF Core, Serilog, Blazor)
- Writing IaC that references a provider resource or data source (AWS, GCP, Azure)
- Unsure of the correct method signature, config option, or decorator for the version in use

Add `use context7` to your lookups before writing implementation code that depends on
external API contracts. Do not guess at API shapes from training data — always verify
against live docs, especially for framework features that change across minor versions.

### github — Branch & PR Operations
Use the GitHub MCP server to:

- Create and push branches when starting a new feature (`feature/NNNN-short-title`)
- Open pull requests targeting the project's default branch
- Check CI status on a branch before considering implementation complete
- Read existing PRs to understand what is already in flight before starting work

### filesystem — Source File Operations
Use the Filesystem MCP server for direct file reads and writes when the standard editor
tools are insufficient — for example:

- Reading a large set of related files (migrations, IaC modules) to understand a pattern
  before writing new code
- Verifying generated output (compiled JS, plan files, test snapshots) that is not part
  of the active editor session

### semgrep — Static Analysis
Use the Semgrep MCP server to run static analysis scans before marking implementation
complete. This catches common security and quality issues early — before the reviewer and
infosec steps:

- Run a scan on any new service or controller file before committing
- Pay particular attention to injection risks, secrets in code, and missing validation
- Address any High or Critical findings before handoff to the reviewer skill

---

## Implementation Consistency

You are responsible for ensuring all layers of the implementation are coherent with each
other before raising a PR. The reviewer will check these — do not leave them to find
problems you could have caught yourself.

### UI ↔ Backend alignment
- Every field returned by a new or modified API endpoint must be either rendered in the UI
  or intentionally unused — if unused, say so in the PR description
- Every field the UI reads or displays must have a corresponding field in the API response
- Form inputs and submitted payloads must match the request DTO/schema exactly — no extra
  fields silently dropped, no required fields missing from the form
- Field names must be consistent across the API contract, database schema, and UI
  (e.g. do not use `createdAt` in one place and `dateCreated` in another)
- Validation rules must be enforced on both sides: a field marked required in the backend
  DTO must also be required in the UI form, and vice versa
- Enum/constant values used in the UI (status labels, type selectors, etc.) must exactly
  match the values accepted and returned by the backend — no hardcoded UI strings that can
  silently diverge from the backend

### No missing fields
- Before considering implementation complete, cross-reference the proposal's data model
  or wireframes against your schema, DTO, and UI form
- Every field present in the proposal must be implemented, or its omission explicitly
  noted in the PR description with justification
- Optional fields deferred to a future iteration must have a placeholder comment so they
  are not silently forgotten

### No introduced inconsistencies
- Do not introduce naming conventions that clash with the existing conventions in the
  same layer — check before inventing a new pattern
- New error response shapes must match the project's existing error contract
- New HTTP status codes must be consistent with how the rest of the API signals the same
  conditions
- Do not duplicate a shared type, constant, or enum that already exists — reuse it
- New config keys must follow the same naming and grouping pattern as existing config keys

### MCP package updates
- If this PR adds, removes, or modifies a tool exposed via an MCP server, you must also
  update the corresponding MCP package in the same PR
- Register new tools in the MCP server's tool list
- Unregister removed tools — do not leave dead tool definitions in the package
- Keep tool input/output schemas in the MCP package in sync with the actual implementation

### Documentation
- Update the README (root and any relevant sub-package) if the change affects:
  - setup or installation steps
  - environment variables or configuration
  - how to run, test, or deploy the project
  - architecture or data flow descriptions
  - any CLI commands or scripts
- Add any new env var to `.env.example` with a comment describing it
- Update API reference docs (Swagger, Redoc, or equivalent) for any new or changed endpoint
  or field — regenerate if the project auto-generates them
- Update the relevant runbook (`infra/README.md` or equivalent) for any infra change
- Add a changelog entry if the project maintains a `CHANGELOG.md` or equivalent

---

## New Dependencies & Supply Chain

Always call out any new package, Terraform module, or provider being added. State:

1. What it does
2. Why the existing stack cannot satisfy the need
3. Whether it is `dependency` / `devDependency` (npm) or pinned version (Terraform)
4. License (must be MIT / Apache-2.0 / BSD / ISC unless explicitly justified)
5. Maintenance status (last release within 12 months; >1M weekly downloads for npm,
   or clearly justified niche)

Run the project's audit command (`npm audit --omit=dev` / `pnpm audit` /
`tofu providers lock`) before adding.

The lockfile is committed and authoritative. Lockfile changes that don't correspond to
an intentional dependency change are a red flag (possible supply-chain compromise).

Never silently add packages, modules, or providers.
