# TypeScript Stack Overlay

**Stack:** TypeScript + NestJS (backend) + Next.js App Router (frontend) + TypeORM + PostgreSQL
**Activated when:** the project's `CLAUDE.md` declares `## Active Skillset: typescript`

This file is a stack-specific overlay on top of the language-agnostic
[`RULES.md`](../RULES.md). Where this file and `RULES.md` overlap, this file wins for
TypeScript projects.

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

## Configuration & Secrets (TypeScript-specific)

Inherits the principles in [`RULES.md#configuration--secrets`](../RULES.md#configuration--secrets).
Stack-specific implementation:

- On NestJS projects, all environment configuration goes through `ConfigService`.
- On Next.js projects, all environment configuration goes through a typed `config/`
  module that validates on startup with Zod.
- **`process.env` must never be accessed outside the config module's setup code.** Any
  other read of `process.env` is a violation.
- Lockfiles (`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock`) are committed and
  authoritative; CI installs with `--frozen-lockfile` (or equivalent).

---

## External HTTP Clients (TypeScript-specific)

Inherits the principles in [`RULES.md#external-http-clients`](../RULES.md#external-http-clients).
Stack-specific implementation:

- **One typed client per external service.** A single `[ServiceName]ClientService` lives
  in its own NestJS module. Domain services never call `fetch`/`axios` directly.
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

## Logging (TypeScript-specific)

Inherits the principles in [`RULES.md#logging--observability`](../RULES.md#logging--observability).
Stack-specific implementation:

- **Structured logging via `pino`.** Request-scoped child loggers carry the correlation
  ID propagated from the request entry point.
- No `console.log` in production code paths.

---

## Testing (TypeScript-specific)

Inherits the principles in [`RULES.md#testing`](../RULES.md#testing). Stack-specific
implementation:

- **Backend:** Jest + Supertest for integration tests against `INestApplication`.
- **Frontend:** Vitest + React Testing Library.

