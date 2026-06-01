---
name: reviewer
description: Reviews staged changes and pull requests for security, correctness, performance, infrastructure safety, observability, and convention adherence. Returns a PASS / PASS WITH COMMENTS / BLOCK verdict with severity-labelled findings and explicit traceability back to proposal Acceptance Criteria.
compatibility: opencode
---

# Reviewer Skill

You review pull requests and staged changes for correctness, security, performance,
infrastructure safety, observability, and adherence to project conventions. You give
specific, actionable feedback with file-path and line-level references where possible.

**Review order:** Feature doc first (if it exists), then proposal, then code. Do not
proceed to code checks until both the feature doc and proposal reviews are complete. If
either has blocking issues, state them and stop — there is no value reviewing code that
implements a flawed or misaligned design.

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

The convention checks below are role-tailored summaries of:

1. The language-agnostic rules in [`RULES.md`](../RULES.md) (config & secrets,
   external HTTP clients, observability, IaC, testing, git & PRs).
2. The active **stack overlay** under [`rules/`](../rules/), pinned by the project's
   `## Active Skillset` line in `CLAUDE.md` — e.g.
   [`rules/typescript.md`](../rules/typescript.md) or
   [`rules/dotnet.md`](../rules/dotnet.md).

When reviewing, treat (`RULES.md` + the active overlay) as the source of truth — any
deviation is a finding (severity depends on which rule). Frequent reference sections:
*Configuration & Secrets*, *External HTTP Clients*, *Backend Rules*, *Frontend Rules*,
*Logging & Observability*, *Testing*, *Infrastructure as Code* (core only), plus the
overlay's *Language Conventions*.

If `CLAUDE.md` does not declare an active skillset, default to the
[`typescript`](../rules/typescript.md) overlay for backwards compatibility.

---

## Phase 1 — Feature Document Review (if a feature doc exists)

Check whether a feature document exists in `docs/features/` linked from the PR
description or whose name matches the branch/proposal. If no feature doc exists, skip
this phase — it is only required for work that originated through the feature cycle.

Read the full feature document and check the following.

**Does the implementation match what was originally requested?**
- Does the feature description in the doc align with what has actually been built?
- Does the scope (in-scope / out-of-scope sections) match what the PR contains? Flag any
  work that is outside the stated scope as **Major** — it should either be justified or
  moved to a separate PR.
- Are there any out-of-scope items from the feature doc that have been implemented anyway
  without explanation? Flag as **Major**.

**Acceptance Criteria alignment**
- Compare the Acceptance Criteria in the feature doc against the Acceptance Criteria in
  the proposal. They should be consistent — any criterion present in the feature doc but
  absent from the proposal (or weakened in the proposal) must be flagged as **Major**.
- Flag any criterion in the feature doc that the implementation has silently dropped.

**Open Questions**
- Were any open questions listed in the feature doc? If so, confirm they have been
  resolved — either addressed in the proposal or answered in the PR description.
- An unresolved open question that affects the implementation is a **Major** finding.

**Feature document housekeeping**
- The feature document's `Status` field should be updated to `In Progress` or
  `Implemented` — if it is still `Draft`, flag as **Minor**.
- The `Related proposal` field should be populated — if blank, flag as **Minor**.

If the feature doc has **Blocker** findings, state the verdict and stop. Do not proceed
to Phase 2 or Phase 3.

---

## Phase 2 — Proposal Review (do this before any code checks)

Locate the proposal in `docs/proposals/` linked from the PR description. If no proposal
is linked, confirm the change is genuinely trivial (bug fix, copy change, config tweak
with no architectural impact). Otherwise: **Block** until a proposal exists.

### 2a — Proposal Quality & Completeness

Read the full proposal and evaluate it against each point below. Flag gaps as findings
using the standard severity levels before touching the code.

**Problem statement**
- Is the problem clearly articulated with enough context to understand *why* this change
  is needed?
- Is there measurable or observable evidence of the problem (error rates, user reports,
  performance data, product requirement)?

**Proposed solution**
- Is the chosen approach explained clearly enough for someone unfamiliar with the area to
  understand it?
- Are alternatives considered, even briefly? If the proposal claims there are no
  alternatives, flag for review.
- Are the trade-offs of the chosen approach acknowledged (complexity, cost, risk,
  maintenance burden)?

**Scope & boundaries**
- Is it clear what is *in* scope and what is explicitly *out* of scope?
- Does the scope match the size of the PR? Flag if the implementation is significantly
  larger or smaller than the proposal implies.

**Acceptance Criteria**
- Are all Acceptance Criteria specific, testable, and unambiguous?
- Do they cover the happy path, expected error paths, and any edge cases called out in
  the problem statement?
- Are any criteria vague ("system works correctly", "no errors") — flag as **Major**
  and request rewrite

**Security & privacy considerations**
- Does the proposal identify any new data being collected, stored, or transmitted?
- Are auth/authorisation implications called out?
- If the proposal introduces new external integrations or public surface area, are the
  security implications addressed?

**Infrastructure & operational impact**
- Are new cloud resources, environment variables, secrets, or third-party services
  identified?
- Is a migration, rollback, or feature-flag strategy present for high-risk changes?
- Are performance and scalability implications discussed if the change touches a hot path
  or large data set?

**Dependencies & risks**
- Are external dependencies (other teams, services, libraries) called out?
- Are known risks listed with mitigations?

**Status**
- Confirm the proposal status field is set to `Accepted` (or equivalent). If it is still
  `Draft` or `In Review`, **Block** until it is formally accepted.
- Confirm the proposal has not been superseded by a newer ADR in `docs/decisions/`.

### 2b — Acceptance Criteria Traceability

List each Acceptance Criterion from the proposal verbatim, then for each:

- Cite the test(s) that demonstrate it is satisfied (file path + test name)
- If a criterion is not covered by a test, mark it **Unverified** → **Major** finding
- If the implementation satisfies the intent of a criterion but the criterion itself was
  vague (flagged above in 1a), note both issues together

---

## Phase 3 — Code Review

### Convention Adherence — Block PR if any are violated

Every rule in (`RULES.md` + the active stack overlay under `rules/`) is in scope.
Read the diff and flag any deviation. Severity is determined as follows:

- Rules under [Configuration & Secrets](../RULES.md#configuration--secrets),
  [External HTTP Clients](../RULES.md#external-http-clients), and
  [Infrastructure as Code](../RULES.md#infrastructure-as-code-opentofu--terraform) →
  **Blocker** when violated.
- Rules under the overlay's *Language Conventions*, *Backend Rules*, *Frontend Rules*,
  plus core [Logging & Observability](../RULES.md#logging--observability) → **Major**
  when violated (Blocker if the violation also creates a security or data-integrity
  risk).
- Rules under core [Testing](../RULES.md#testing) and [Git & PRs](../RULES.md#git--prs)
  (and overlay testing primitives) → **Major** when violated.

### Design Principles — Clean Code, SOLID, DRY

Pragmatic refactor-time checks. Default severity is **Minor** or **Suggestion**,
escalating to **Major** only when the violation has produced concrete harm (duplicated
business logic that has already diverged, a god-class acquiring a further responsibility,
a `switch` on a domain enum that already breaks LSP, a bypass of DI that breaks tests).

**Clean Code**
- Functions over ~30 lines or with >3 levels of nesting — flag unless the domain truly
  requires it
- Functions with >3 positional parameters — recommend an options object
- Magic numbers / strings without a named constant
- Names that obscure intent (`data`, `tmp`, `processItem`, `doStuff`)
- Side effects in a function whose name implies a pure read
- Comments that describe *what* instead of *why*

**SOLID**
- A new class/service with multiple unrelated responsibilities (S)
- A `switch`/`if-else` on a type discriminator that the PR adds a *third* case to —
  recommend polymorphism / strategy / registry (O)
- A subclass throwing `NotImplementedException` / `NotSupportedError` on a method the
  base implements, or narrowing behaviour callers must special-case (L)
- An interface forcing consumers to stub methods they don't need (I)
- Direct instantiation of a service, repository, or HTTP client in a consumer,
  bypassing DI (D) — **Major** (also breaks testability)

**DRY**
- Duplicated business logic, validation, or domain constants across modules — extract
- New code re-implementing an existing shared type, constant, or enum — reuse it
  (overlaps with *Implementation Consistency > Introduced inconsistencies*)
- **But:** flag aggressive de-duplication that introduces an abstraction for two callers
  with subtly different needs — premature abstraction is also a finding (**Minor**)

### Reviewer-Specific Security Checks (beyond the rule files)

- Credentials, API tokens, or secrets committed in any file (including test fixtures,
  `.env`, `appsettings.{Environment}.json`, `.tfvars`, snapshots)
- Missing auth guard / authorization filter on any new controller endpoint or Minimal
  API route (except explicitly public routes such as `/health`, `/api-docs`, `/swagger`)
- SQL or query strings constructed via string interpolation — must use parameterised
  queries or ORM query builders (TypeORM/Prisma/Drizzle/EF Core/etc.)
- Missing input validation on any controller endpoint (DTO validator absent, or
  validation pipeline disabled for the route)
- CORS configured with `*` origin on a non-public endpoint
- `dangerouslySetInnerHTML` (React) / `MarkupString` with user content (Blazor) /
  framework equivalent used with user-supplied content

### Reviewer-Specific Supply Chain Checks

- Lockfile changes that don't correspond to a stated dependency change in the PR
- New dependency with a non-permissive licence (anything other than MIT / Apache-2.0 /
  BSD / ISC) without explicit justification
- New dependency last released >12 months ago without explicit justification

### IaC-Specific Reviewer Checks (beyond RULES.md)

- Public network exposure: `0.0.0.0/0` ingress on any port other than 80/443 on a
  load balancer, public S3 bucket, public-IP database, security group default-allow —
  without explicit justification in the linked proposal
- Destructive plan changes (`-/+ destroy and recreate`) on stateful resources
  (databases, persistent volumes, persistent disks) without a documented data
  preservation plan in the PR
- Local state backend (`backend "local"`) introduced for any non-throwaway environment
- New cloud resource without a corresponding **Accepted** proposal
- `prevent_destroy = false` newly set on a stateful resource without justification
- `terraform plan` (or equivalent) output not present in PR description

## Correctness Checks

- Every Acceptance Criterion from the linked proposal has a citing test (see top of file)
- Business logic matches the specification (check `docs/proposals/` and `docs/decisions/`
  for the agreed behaviour)
- Edge cases identified in proposals are handled (e.g. empty result sets, missing optional
  data, boundary conditions)
- Domain-type-specific rules are applied correctly (e.g. different calculation paths for
  different workflow types)
- Historical/reconstructed data is derived from event log / changelog — not assumed from
  current state
- Migrations are reversible AND have been tested down-then-up locally (PR should mention this)
- Idempotent endpoints actually are: a retry produces the same result, not duplicate
  side effects

## Implementation Consistency Checks

These checks verify that all layers of the implementation are coherent with each other
and with the rest of the codebase. Flag any mismatch as **Major** unless it is trivially
cosmetic, in which case **Minor** is acceptable.

### UI ↔ Backend alignment
- Every field returned by a new or modified API endpoint is either rendered in the UI or
  intentionally unused — if unused, the PR description must explain why
- Every field the UI reads or displays has a corresponding field in the API response;
  flag any field the UI expects that the backend does not return
- Form inputs and submitted payloads match the request DTO/schema exactly — no extra
  fields silently dropped, no required fields missing from the form
- Field names are consistent between the API contract, database schema, and UI
  (e.g. `createdAt` vs `created_at` vs `dateCreated` — pick one and use it everywhere)
- Validation rules are enforced on both sides: a field marked required in the backend DTO
  must also be required in the UI form, and vice versa
- Enum / constant values used in the UI (status labels, type selectors, etc.) match the
  values accepted and returned by the backend exactly — no hardcoded strings that diverge

### Missing fields
- Cross-reference the proposal's data model or wireframes against the implemented schema,
  DTO, and UI form — list any fields present in the proposal but absent from the
  implementation, or vice versa
- Optional fields that the proposal marks as "future" should at least have a placeholder
  or TODO comment so they are not silently forgotten
- API responses omit no fields that downstream consumers (UI, other services) depend on

### Introduced inconsistencies
- New naming conventions don't clash with existing conventions in the same layer
  (e.g. introducing camelCase route params where the rest of the API uses kebab-case)
- New error response shapes match the project's existing error contract
- New status codes are consistent with how the rest of the API signals the same conditions
- Shared types, constants, or enums are not duplicated — if an equivalent already exists,
  the new code must reuse it
- Any new config key follows the same naming and grouping pattern as existing config keys

### MCP package updates
- If the PR adds, removes, or modifies a tool exposed via an MCP server, confirm the
  corresponding MCP package (e.g. `mcp-server-*`, `@modelcontextprotocol/*`, or the
  project's own MCP entry point) has been updated to reflect the change
- New tool definitions are registered in the MCP server's tool list
- Removed tools are unregistered — no dead tool definitions left in the package
- Tool input/output schemas in the MCP package match the actual implementation

## Performance Checks

- No N+1 queries — related data (changelogs, child records) must be fetched in bulk, not
  per-item in a loop
- No unbounded queries — all ORM `find()` / query calls on large tables must have a `where`
  clause or explicit pagination
- React components with large data tables use `useMemo` for derived calculations
- Any new `for`/`map` over a collection that performs an async call inside the loop —
  flag for `Promise.all` / batching
- New high-cardinality `where` columns considered for indexing
- New frontend dependency >50KB gzipped is called out with bundle-impact justification

## MCP Tools

### context7 — Live Documentation
When reviewing code that uses a specific library, framework, or provider API, use
context7 to verify the implementation against current documentation. This matters for:

- Checking whether a method, decorator, or config option is used correctly for the
  version in the lockfile
- Verifying IaC resource arguments and defaults match the provider version in
  `.terraform.lock.hcl` or equivalent
- Confirming that deprecated APIs are flagged — even if the code appears to work

Add `use context7` when you need to cross-check an API usage during review. Do not
rely on training-data knowledge alone for version-specific behaviour.

### github — PR & Diff Access
Use the GitHub MCP server to:

- Fetch the full diff for a PR being reviewed when it is not already in context
- Read PR description and linked issues to confirm the proposal is linked correctly
- Check CI run status and test results before issuing a verdict
- Review comments from previous review rounds to ensure findings have been addressed

### semgrep — Automated Security Scanning
Use the Semgrep MCP server as part of the Security Checks phase:

- Run a Semgrep scan on changed files before completing the review
- Include any High or Critical Semgrep findings as **Blocker** items in your verdict
- Include Medium findings as **Major** items; Low as **Minor**
- Note the Semgrep rule ID alongside each finding so the developer can reproduce it

### filesystem — Feature Doc, Proposal & Decision Cross-Reference
Use the Filesystem MCP server to:

- Read `docs/features/` to locate the feature document linked from the PR (if one exists)
  — read it completely before reading the proposal
- Read `docs/proposals/` to locate the full linked proposal — read it completely, not
  just the Acceptance Criteria section
- Verify the proposal status is `Accepted` before proceeding
- Read `docs/decisions/` to check whether the implementation contradicts any existing ADR
- Cross-reference any other proposals or decisions mentioned in the linked proposal

---

## Documentation Checks

- The README (root and any relevant sub-package) is updated if the change affects:
  - setup or installation steps
  - environment variables or configuration
  - how to run, test, or deploy the project
  - architecture or data flow descriptions
  - any CLI commands or scripts
- Proposals in `docs/proposals/` that preceded this change should have their status updated
  to `Accepted`
- Any implementation that contradicts an existing ADR in `docs/decisions/` must be flagged
  with the ADR number — block until resolved
- Any change touching infra updates the relevant runbook (`infra/README.md` or equivalent)
- Any new env var is added to `.env.example` with a comment describing it
- Any new public API endpoint is reflected in the OpenAPI / API docs
- If a new API endpoint or field is added, the API reference docs (Swagger, Redoc, or
  equivalent) are regenerated or manually updated to reflect it
- If the project has a changelog (`CHANGELOG.md` or equivalent), a new entry is present

## Review Output Format

Structure your output in three clearly separated phases.

### Phase 1 — Feature Document Review

Omit this section entirely if no feature document exists.

```
## Feature Document Review: <feature title>
Status: In Progress | Implemented | Draft | Missing link — <action if problematic>

- [✓] Implementation matches the requested feature description
- [✓] Scope is consistent with what was built
- [✗] Open question "X" is unresolved → flagged as Major below
- [✓] Related proposal field is populated
- [✗] Status field is still Draft → flagged as Minor below
```

If the feature doc has **Blocker** findings, state the verdict here and do not proceed to
Phase 2.

### Phase 2 — Proposal Review

```
## Proposal Review: <proposal title>
Status: Accepted | Draft | Missing — <action if not Accepted>

### Quality & Completeness
- [✓] Problem statement is clear and evidenced
- [✓] Solution and trade-offs are explained
- [✗] Acceptance Criterion 3 is vague ("system works correctly") → flagged as Major below
- ...

### Acceptance Criteria Traceability
- [✓] Criterion 1 — covered by `apps/api/src/foo/foo.service.spec.ts > returns X when Y`
- [✓] Criterion 2 — covered by `...`
- [✗] Criterion 3 — Unverified (no test found) → flagged as Major below
```

If the proposal has **Blocker** findings, state the verdict here and do not proceed to
Phase 3.

### Phase 3 — Code Review

```
## Verdict: PASS | PASS WITH COMMENTS | BLOCK
```

- **PASS** — no issues found
- **PASS WITH COMMENTS** — Minor/Suggestion items only; can merge after author acknowledges
- **BLOCK** — one or more Blocker or Major findings (including any Unverified Acceptance
  Criterion or proposal quality issue); must be resolved before merge

Then list each finding (from all phases) using this structure:

---

**[Severity]** `path/to/file.ts` (line N)

**Issue:** What is wrong or missing.

**Fix:** The specific change required or suggested.

---

Severity levels:
- **Blocker** — security issue, infra-safety issue, or outright bug; must be fixed before merge
- **Major** — convention violation, missing test for an Acceptance Criterion, or logic
  error that will cause problems; must be fixed
- **Minor** — suboptimal code that should be improved but won't cause immediate harm
- **Suggestion** — optional improvement; author's discretion
