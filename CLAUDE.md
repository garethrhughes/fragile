# CLAUDE.md — Jira DORA & Planning Metrics Dashboard

## Project Overview

Full-stack internal engineering metrics dashboard. Reads Jira Cloud data and produces DORA
metrics reports and sprint planning accuracy reports. Internal use only — single-user,
authenticated via a static API key.

---

## Tech Stack

### Backend
| Concern | Choice |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript (strict mode) |
| ORM | TypeORM with PostgreSQL 16 (pg driver) |
| Auth | Passport.js — `HeaderAPIKeyStrategy` |
| API Docs | Swagger (`@nestjs/swagger`) |
| Rate Limiting | `@nestjs/throttler` — 100 req/min/IP globally |
| Scheduler | `@nestjs/schedule` — cron-based Jira sync |
| Testing | Jest + Supertest |
| Migrations | TypeORM CLI (`npm run migration:run`) |

### Frontend
| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS v4 (CSS-first, no `tailwind.config.js`) |
| State | Zustand |
| Icons | Lucide React |
| Testing | Vitest + React Testing Library |
| HTTP | Native `fetch` via typed wrappers in `apps/web/lib/api.ts` |

### Infrastructure
| Concern | Choice |
|---|---|
| Local DB | Docker Compose — PostgreSQL 16, db `ai_starter`, port `5432` |
| Task Automation | Makefile |
| Config | `.env` files (never committed) — `.env.example` provided |

---

## Repository Structure

```
/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── app.module.ts
│   │       ├── main.ts
│   │       ├── config/
│   │       ├── auth/
│   │       ├── jira/           # Jira API client & sync
│   │       ├── metrics/        # DORA calculation services
│   │       ├── planning/       # Sprint accuracy services
│   │       ├── boards/         # Board config & rules
│   │       ├── database/       # TypeORM entities, migrations, seeds
│   │       └── common/         # Guards, decorators, interceptors
│   └── web/
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx
│       │   ├── dora/page.tsx
│       │   ├── planning/page.tsx
│       │   └── settings/page.tsx
│       ├── components/
│       │   ├── charts/
│       │   ├── layout/
│       │   └── ui/
│       ├── store/
│       └── lib/
├── docker-compose.yml
├── Makefile
└── .env.example
```

---

## Architecture Rules

### Backend
- One module per feature domain: `jira`, `metrics`, `planning`, `boards`, `auth`
- Controllers are thin — all business logic in services
- All Jira HTTP calls through a single typed `JiraClient` — never call Jira directly from metric services
- Environment config via `ConfigService` only — never `process.env` directly
- No hardcoded Jira base URLs, board IDs, or status names — always from config or `BoardConfig`
- No N+1 queries — changelog and sprint data fetched in bulk, not per-issue
- All `find()` calls on `JiraIssue` or `JiraChangelog` require a `where` clause or explicit pagination
- `ThrottlerGuard` applied globally at 100 requests/min/IP

### Frontend
- All API calls through `apps/web/lib/api.ts`
- Zustand stores in `apps/web/store/` — one file per concern (filter, auth, sync)
- No direct state mutation outside the store — mutations only via defined actions
- Tailwind v4 only — CSS-first config via `@theme` in `globals.css`; no `tailwind.config.js`
- Components: `ui/`, `charts/`, `layout/` subdirectories
- No logic in page components — delegate to services/hooks
- Components with large data tables must use `useMemo` for derived calculations

### TypeScript
- Strict mode throughout — no `any`, no implicit returns

---

## Security Rules (hard blocks)

- No credentials, tokens, or secrets committed in any file
- `process.env` must not be accessed outside `ConfigService`
- All controller endpoints require `@UseGuards(ApiKeyAuthGuard)` except `GET /health` and `/api-docs`
- No SQL built via string interpolation — use TypeORM query builder or parameters
- No hardcoded Jira base URLs or board IDs in source

---

## DORA Metrics

### Deployment Frequency
- **Signal (priority):** fixVersion with `releaseDate` in range → fallback: transition to done status
- **Done statuses (default):** `Done`, `Closed`, `Released` — configurable per board
- **Bands:** Elite = multiple/day, High = daily–weekly, Medium = weekly–monthly, Low = <monthly

### Lead Time for Changes
- **Calculation:** `issue.createdAt` → first transition to done/released (from changelog); if fixVersion present, use `releaseDate` as endpoint. Output: median and p95 in days.
- **Bands:** Elite = <1 day, High = 1 day–1 week, Medium = 1 week–1 month, Low = >1 month

### Change Failure Rate (CFR)
- **Calculation:** `(failure issues / total deployments) * 100`
- **Configurable per board (`BoardConfig`):** `failureIssueTypes`, `failureLinkTypes`, `failureLabels`
- **Bands:** Elite = 0–5%, High = 5–10%, Medium = 10–15%, Low = >15%

### MTTR
- **Calculation:** median of `(recoveryDate − failureCreatedDate)` across failure issues in period
- **Configurable per board:** `incidentIssueTypes`, `recoveryStatusName`, `incidentLabels`
- **Bands:** Elite = <1 hr, High = <1 day, Medium = <1 week, Low = >1 week

### Band Classifier
Pure functions only, no side effects, no DB calls. Lives in `apps/api/src/metrics/dora-bands.ts`:
```typescript
export type DoraBand = 'elite' | 'high' | 'medium' | 'low'
export function classifyDeploymentFrequency(deploymentsPerDay: number): DoraBand
export function classifyLeadTime(medianDays: number): DoraBand
export function classifyChangeFailureRate(percentage: number): DoraBand
export function classifyMTTR(medianHours: number): DoraBand
```

---

## Planning Accuracy

| Field | Formula |
|---|---|
| Commitment | Issues in sprint at `startDate` (reconstructed from changelog) |
| Added | Issues added after `startDate` |
| Removed | Issues removed before sprint end |
| Completed | Issues with Done status at sprint end |
| Scope Change % | `(added + removed) / commitment * 100` |
| Completion Rate | `completed / (commitment + added - removed) * 100` |

Sprint membership at start date **must** be reconstructed from changelog entries — Jira does not expose a historical snapshot directly.

---

## Boards

| Board Key | Type |
|---|---|
| ACC | Scrum |
| BPT | Scrum |
| SPS | Scrum |
| OCS | Scrum |
| DATA | Scrum |
| PLAT | Kanban |

**Kanban (PLAT):**
- No sprints — deployment frequency and lead time use a rolling date window from selected quarter
- Cycle time (first `In Progress` → `Done`) replaces lead time
- Planning accuracy: return HTTP 400 with `"Planning accuracy is not available for Kanban boards"` when `boardType === 'kanban'`; show a notice in the UI

---

## Database Schema

```
BoardConfig     — board settings, done status names, CFR/MTTR rules
JiraSprint      — id, name, state, startDate, endDate, boardId
JiraIssue       — key, summary, status, issueType, fixVersion, points, sprintId, createdAt, updatedAt
JiraChangelog   — issueKey, fromStatus, toStatus, changedAt
JiraVersion     — id, name, releaseDate, projectKey
SyncLog         — boardId, syncedAt, issueCount, status
```

All schema changes via TypeORM CLI migrations. Migrations must implement both `up()` and `down()`.
Never edit generated migration files manually.

---

## API Endpoints

```
GET  /health                            — health check (unguarded)
GET  /api-docs                          — Swagger UI (unguarded)

POST /api/sync                          — trigger full Jira sync
GET  /api/sync/status                   — last sync time per board

GET  /api/boards                        — list all configured boards
GET  /api/boards/:boardId/config        — get board config
PUT  /api/boards/:boardId/config        — update board config

GET  /api/metrics/dora                  — all 4 DORA metrics
  ?boardId=ACC,BPT,...
  &period=sprint|quarter
  &sprintId=123
  &quarter=2025-Q1

GET  /api/metrics/deployment-frequency
GET  /api/metrics/lead-time
GET  /api/metrics/cfr
GET  /api/metrics/mttr

GET  /api/planning/accuracy
  ?boardId=ACC
  &sprintId=123
  &quarter=2025-Q1

GET  /api/planning/sprints
GET  /api/planning/quarters
```

---

## Testing Requirements

### Backend (Jest)
- Unit tests for all metric calculation services (mock Jira fixtures)
- Unit tests for DORA band classification utility
- Integration tests for `/api/metrics/dora` (mock DB)
- Unit tests for planning accuracy calculation
- Test services directly — do not test controllers

### Frontend (Vitest)
- Unit tests for `MetricCard`, `BandBadge`, `DataTable`
- Unit tests for Zustand stores in isolation
- Unit tests for DORA band classifier if duplicated on frontend

---

## Design & Proposal Workflow

Write a proposal in `docs/proposals/NNNN-short-kebab-case-title.md` before implementing any:
- New module, service, or significant component
- Module boundary or data flow change
- New Jira API integration point
- Schema change affecting more than one entity
- Cross-cutting concern (caching, error handling strategy, etc.)

When a proposal is accepted, create the corresponding ADR in `docs/decisions/NNNN-title.md`
and update the proposal status to `Accepted`.

---

## Settled Decisions (do not revisit without a superseding ADR)

| # | Decision |
|---|---|
| 0001 | Jira fix versions are the primary deployment signal; done-status transition is the fallback |
| 0002 | Jira data cached in Postgres — not queried live per request |
| 0003 | CFR and MTTR rules are per-board, stored in `BoardConfig` |
| 0004 | Single-user API key auth via Passport `HeaderAPIKeyStrategy` |
| 0005 | Kanban boards excluded from planning accuracy |
| 0006 | Sprint membership at start date reconstructed from Jira changelog |
| 0007 | Monorepo with `apps/api` and `apps/web` |
| 0008 | Tailwind CSS v4 with CSS-first configuration — no `tailwind.config.js` |

---

## Edge Cases

| Case | Handling |
|---|---|
| Kanban (PLAT) — no sprints | Use rolling date window from selected quarter; disable planning accuracy |
| Missing fix versions | Fall back to "moved to Done" as deployment signal |
| Partial / active sprints | Include but flag with "Active" badge in UI |
| Empty boards (no data in period) | Show empty state card — not zero values |
| Changelog reconstruction | Reconstruct sprint membership from changelog — do not use current sprint field |
| Jira rate limiting | Exponential backoff, max 3 retries on HTTP 429 |

---

## Jira Sync

- Scheduled via `@nestjs/schedule` cron — default every 30 minutes
- `POST /api/sync` triggers a manual refresh
- `SyncLog` records each run (boardId, syncedAt, issueCount, status)
- Show last-synced timestamp in UI header
- Jira client uses exponential backoff, max 3 retries on HTTP 429
