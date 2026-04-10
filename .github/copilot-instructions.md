# GitHub Copilot Instructions — Jira DORA & Planning Metrics Dashboard

## Project Overview

Full-stack internal engineering metrics dashboard that reads data from Jira Cloud and
produces DORA metrics reports and sprint planning accuracy reports. Internal engineering
team use only. Single-user, authenticated via a static API key stored in environment config.

---

## Tech Stack

### Backend
| Concern | Choice |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript (strict mode) |
| ORM | TypeORM with PostgreSQL 16 (pg driver) |
| Auth | Passport.js — API key strategy (`HeaderAPIKeyStrategy`) |
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
| HTTP | Native `fetch` with typed wrappers in `apps/web/lib/api.ts` |

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

## Environment Variables

```dotenv
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_USER_EMAIL=your@email.com
JIRA_API_TOKEN=your_api_token_here
JIRA_BOARD_IDS=ACC,BPT,SPS,OCS,DATA,PLAT

APP_API_KEY=your_dashboard_api_key_here

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_starter

API_PORT=3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

---

## Makefile Targets

| Target | Action |
|---|---|
| `up` | `docker compose up -d` |
| `down` | `docker compose down` |
| `migrate` | Run TypeORM migrations |
| `seed` | Seed board config defaults |
| `dev-api` | Start NestJS in watch mode |
| `dev-web` | Start Next.js dev server |
| `test-api` | Jest |
| `test-web` | Vitest run |
| `sync` | Trigger manual Jira data sync via API |

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

**Kanban (PLAT):** No sprints exist. Deployment frequency and lead time use a rolling date
window from the selected quarter. Cycle time (first `In Progress` → `Done`) replaces lead
time. Planning accuracy report must be hidden/disabled with a clear UI message.

---

## Auth

- Passport `HeaderAPIKeyStrategy` — validates `x-api-key` header against `APP_API_KEY` env var
- All API routes protected by `@UseGuards(ApiKeyAuthGuard)` except `GET /health` and Swagger
- Frontend: stores key in `localStorage`, attaches it as a header on all requests
- Settings page allows re-entry or clearing of the key

---

## Jira Integration

### API Endpoints Used

- `GET /rest/api/3/board/{boardId}/sprint` — list sprints per board
- `GET /rest/api/3/board/{boardId}/sprint/{sprintId}/issue` — issues in sprint
- `GET /rest/api/3/issue/{issueKey}/changelog` — status transition history
- `GET /rest/agile/1.0/board/{boardId}/version` — fix versions (releases)
- `GET /rest/api/3/project/{projectKey}/version` — project versions
- `GET /rest/api/3/issue/picker` + JQL — flexible issue queries

### Data Sync Strategy

- Scheduled via `@nestjs/schedule` cron — default: every 30 minutes
- Cache raw responses in Postgres (`JiraIssue`, `JiraSprint`, `JiraVersion`, `JiraChangelog`)
- `POST /api/sync` triggers a manual refresh
- `SyncLog` records each sync run (boardId, syncedAt, issueCount, status)
- Show last-synced timestamp in the UI header
- Jira client uses exponential backoff, max 3 retries on HTTP 429

---

## Database Schema (TypeORM Entities)

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

GET  /api/planning/sprints              — list available sprints per board
GET  /api/planning/quarters            — list available quarters from sprint data
```

All endpoints except `/health` and `/api-docs` require `@UseGuards(ApiKeyAuthGuard)`.

---

## DORA Metrics

### Deployment Frequency

**Data source (priority order):**
1. Issues with a `fixVersion` whose `releaseDate` falls within the filter range
2. Issues transitioned to a configurable done status (default: `Done`, `Closed`, `Released`)

**DORA bands:**
| Band | Threshold |
|---|---|
| Elite | Multiple times per day |
| High | Once per day — once per week |
| Medium | Once per week — once per month |
| Low | Less than once per month |

---

### Lead Time for Changes

**Calculation:** `issue.createdAt` → date of transition to Done/Released (from changelog).
If `fixVersion` present, use version `releaseDate` as endpoint. Output: median and p95 in days.

**DORA bands:**
| Band | Threshold |
|---|---|
| Elite | < 1 day |
| High | 1 day — 1 week |
| Medium | 1 week — 1 month |
| Low | > 1 month |

---

### Change Failure Rate (CFR)

**Calculation:** `(failure issues / total deployments) * 100`

**Configurable per board via `BoardConfig`:**
- `failureIssueTypes`: default `["Bug", "Incident"]`
- `failureLinkTypes`: default `["is caused by", "caused by"]`
- `failureLabels`: default `["regression", "incident", "hotfix"]`

**DORA bands:**
| Band | Threshold |
|---|---|
| Elite | 0–5% |
| High | 5–10% |
| Medium | 10–15% |
| Low | > 15% |

---

### Mean Time to Recovery (MTTR)

**Calculation:** Median of `(recoveryDate − failureCreatedDate)` across all failure issues in period.

**Configurable per board via `BoardConfig`:**
- `incidentIssueTypes`: default `["Bug", "Incident"]`
- `recoveryStatusName`: default `"Done"`, `"Resolved"`
- `incidentLabels`: labels used to identify incidents

**DORA bands:**
| Band | Threshold |
|---|---|
| Elite | < 1 hour |
| High | < 1 day |
| Medium | < 1 week |
| Low | > 1 week |

---

### DORA Band Classifier

Pure functions in `apps/api/src/metrics/dora-bands.ts`. No side effects, no DB calls.
Duplicate or share to frontend as needed.

```typescript
export type DoraBand = 'elite' | 'high' | 'medium' | 'low'

export function classifyDeploymentFrequency(deploymentsPerDay: number): DoraBand { ... }
export function classifyLeadTime(medianDays: number): DoraBand { ... }
export function classifyChangeFailureRate(percentage: number): DoraBand { ... }
export function classifyMTTR(medianHours: number): DoraBand { ... }
```

---

## Planning Accuracy

### Calculation (per sprint)

| Field | Formula |
|---|---|
| Commitment | Issues in sprint at `startDate` (reconstructed from changelog) |
| Added | Issues added after `startDate` |
| Removed | Issues removed before sprint end |
| Completed | Issues with Done status at sprint end |
| Scope Change % | `(added + removed) / commitment * 100` |
| Completion Rate | `completed / (commitment + added - removed) * 100` |

**Sprint membership at start date must be reconstructed from changelog entries.**
Jira does not expose a historical sprint snapshot directly.

**Kanban (PLAT):** Return HTTP 400 with message:
`"Planning accuracy is not available for Kanban boards"`
when `boardType === 'kanban'`. Show a notice in the UI.

---

## Zustand Store Structure

```typescript
// stores/filterStore.ts
interface FilterState {
  selectedBoards: string[]
  periodType: 'sprint' | 'quarter'
  selectedSprint: string | null
  selectedQuarter: string | null
  setSelectedBoards: (boards: string[]) => void
  setPeriodType: (type: 'sprint' | 'quarter') => void
  setSelectedSprint: (sprintId: string | null) => void
  setSelectedQuarter: (quarter: string | null) => void
}

// stores/authStore.ts
interface AuthState {
  apiKey: string | null
  setApiKey: (key: string) => void
  clearApiKey: () => void
}

// stores/syncStore.ts
interface SyncState {
  lastSynced: Record<string, string>  // boardId -> ISO timestamp
  isSyncing: boolean
  triggerSync: () => Promise<void>
}
```

Zustand store mutations only via defined actions — no direct state mutation outside the store.

---

## Frontend Pages & Components

### `/dora` — DORA Dashboard
- Multi-select board chips (defaults to all)
- Sprint dropdown or quarter dropdown
- 2×2 grid of `MetricCard` — value, band badge, trend sparkline (last 6 periods)
- Board-level breakdown table per metric
- Last synced timestamp + manual sync button in header

### `/planning` — Planning Accuracy
- Single board selector (Kanban boards disabled with tooltip)
- Sprint or quarter filter
- Summary stats: avg scope change %, avg completion rate
- Sprint-by-sprint `DataTable` with conditional row colouring:
  - > 20% scope change = amber
  - > 40% scope change = red
- Trend chart: scope change % over time

### `/settings` — Settings
- API key entry / update
- Per-board config editor (CFR/MTTR rules, done status names)
- Save triggers `PUT /api/boards/:boardId/config`

### Shared Components

| Component | Description |
|---|---|
| `MetricCard` | Value, band badge, sparkline, trend arrow |
| `BandBadge` | Elite=green, High=blue, Medium=amber, Low=red |
| `BoardChip` | Selectable board filter chip |
| `SprintSelect` | Dropdown of available sprints |
| `QuarterSelect` | Dropdown of available quarters |
| `SyncStatus` | Last synced time with refresh button |
| `DataTable` | Sortable table with conditional row styling |

Components with large data tables must use `useMemo` for derived calculations.

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
- Zustand stores in `apps/web/store/` — one file per concern
- Tailwind v4 only — CSS-first config via `@theme` in `globals.css`; no `tailwind.config.js`
- Components: `ui/`, `charts/`, `layout/` subdirectories

---

## Security Rules (Block PR if violated)

- Credentials, tokens, or secrets committed in any file
- `process.env` accessed outside `ConfigService`
- Missing `@UseGuards(ApiKeyAuthGuard)` on any endpoint except `/health` and `/api-docs`
- SQL built via string interpolation — use TypeORM query builder or parameters
- Jira base URL or board IDs hardcoded in source

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

## Agent Roles

| Agent | File | Responsibility |
|---|---|---|
| Architect | `.github/agents/copilot-architect.agent.md` | System design, proposals, module boundaries, schema |
| Developer | `.github/agents/copilot-developer.agent.md` | TypeScript implementation across `api` and `web` |
| Code Reviewer | `.github/agents/copilot-reviewer.agent.md` | PR review — correctness, security, performance, conventions |
| Decision Log | `.github/agents/copilot-decision-log.agent.md` | ADR authoring and maintenance in `docs/decisions/` |

---

## Suggested Build Sequence

1. Scaffold — monorepo structure, Docker Compose, Makefile, `.env.example`
2. Backend foundation — NestJS app, TypeORM config, DB connection, health endpoint
3. Auth — Passport API key strategy, guard, middleware
4. Database — all entities + initial migration
5. Jira client — typed HTTP client wrapping REST API v3 + Agile API
6. Sync service — scheduled + manual sync, `SyncLog` writes
7. Metric services — one service per DORA metric + band classifier
8. Planning service — sprint scope change calculations
9. API controllers — all endpoints with Swagger decorators
10. Frontend scaffold — Next.js app, Tailwind v4, Zustand stores, API client
11. Shared components — `MetricCard`, `BandBadge`, `DataTable`, etc.
12. DORA dashboard page
13. Planning accuracy page
14. Settings page
15. Tests — backend Jest, frontend Vitest
16. README — setup, env config, Makefile usage

---

## Settled Decisions

The following are established — do not revisit without creating a superseding ADR in `docs/decisions/`.

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
