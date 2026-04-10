# GitHub Copilot Project Brief â€” Jira DORA & Planning Metrics Dashboard

## Project Overview

Build a full-stack internal engineering metrics dashboard that reads data from Jira Cloud and
produces DORA metrics reports and sprint planning accuracy reports. The tool is for internal
engineering team use only, authenticated via a single Jira API token stored in environment config.

---

## Tech Stack

### Frontend
| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS v4 |
| State Management | Zustand |
| Icons | Lucide React |
| Testing | Vitest + React Testing Library |
| HTTP Client | fetch (native) with typed wrappers |

### Backend
| Concern | Choice |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript (strict mode) |
| ORM | TypeORM with PostgreSQL 16 (pg driver) |
| Auth | Passport.js â€” API key strategy (single-user, token from env) |
| API Docs | Swagger (`@nestjs/swagger`) |
| Rate Limiting | `@nestjs/throttler` |
| Testing | Jest + Supertest |
| Migrations | TypeORM CLI (`npm run migration:run`) |

### Infrastructure
| Concern | Choice |
|---|---|
| Local DB | Docker Compose â€” PostgreSQL 16, database `ai_starter`, port `5432` |
| Task Automation | Makefile |
| Config | `.env` files (never committed) â€” `.env.example` provided |

---

## Repository Structure

```
/
â”œâ”€â”€ apps/
â”‚   â”œâ”€â”€ api/              # NestJS backend
â”‚   â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”‚   â”œâ”€â”€ app.module.ts
â”‚   â”‚   â”‚   â”œâ”€â”€ main.ts
â”‚   â”‚   â”‚   â”œâ”€â”€ config/
â”‚   â”‚   â”‚   â”œâ”€â”€ auth/
â”‚   â”‚   â”‚   â”œâ”€â”€ jira/           # Jira API client & sync
â”‚   â”‚   â”‚   â”œâ”€â”€ metrics/        # DORA calculation services
â”‚   â”‚   â”‚   â”œâ”€â”€ planning/       # Sprint accuracy services
â”‚   â”‚   â”‚   â”œâ”€â”€ boards/         # Board config & rules
â”‚   â”‚   â”‚   â”œâ”€â”€ database/       # TypeORM entities, migrations, seeds
â”‚   â”‚   â”‚   â””â”€â”€ common/         # Guards, decorators, interceptors
â”‚   â”‚   â”œâ”€â”€ test/
â”‚   â”‚   â””â”€â”€ package.json
â”‚   â””â”€â”€ web/              # Next.js frontend
â”‚       â”œâ”€â”€ app/
â”‚       â”‚   â”œâ”€â”€ layout.tsx
â”‚       â”‚   â”œâ”€â”€ page.tsx
â”‚       â”‚   â”œâ”€â”€ dora/
â”‚       â”‚   â”‚   â””â”€â”€ page.tsx
â”‚       â”‚   â”œâ”€â”€ planning/
â”‚       â”‚   â”‚   â””â”€â”€ page.tsx
â”‚       â”‚   â””â”€â”€ settings/
â”‚       â”‚       â””â”€â”€ page.tsx
â”‚       â”œâ”€â”€ components/
â”‚       â”‚   â”œâ”€â”€ charts/
â”‚       â”‚   â”œâ”€â”€ layout/
â”‚       â”‚   â””â”€â”€ ui/
â”‚       â”œâ”€â”€ store/          # Zustand stores
â”‚       â”œâ”€â”€ lib/            # API client, utils
â”‚       â””â”€â”€ package.json
â”œâ”€â”€ docker-compose.yml
â”œâ”€â”€ Makefile
â””â”€â”€ .env.example
```

---

## Environment Variables

```dotenv
# .env.example

# Jira
JIRA_BASE_URL=https://your-org.atlassian.net
JIRA_USER_EMAIL=your@email.com
JIRA_API_TOKEN=your_api_token_here
JIRA_BOARD_IDS=ACC,BPT,SPS,OCS,DATA,PLAT   # comma-separated

# App Auth (single-user API key for the dashboard)
APP_API_KEY=your_dashboard_api_key_here

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_starter

# App
API_PORT=3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

---

## Docker Compose

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ai_starter
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## Makefile Targets

```makefile
up          # docker compose up -d
down        # docker compose down
migrate     # run TypeORM migrations
seed        # seed board config defaults
dev-api     # start NestJS in watch mode
dev-web     # start Next.js dev server
test-api    # jest
test-web    # vitest run
sync        # trigger manual Jira data sync via API
```

---

## Jira Integration

### Boards
| Board Key | Type |
|---|---|
| ACC | Scrum |
| BPT | Scrum |
| SPS | Scrum |
| OCS | Scrum |
| DATA | Scrum |
| PLAT | Kanban |

> **Kanban note:** PLAT has no sprints. For PLAT, cycle time replaces lead-time-for-changes
> calculations and deployment frequency is measured by issues moved to Done or fix version
> releases within the selected date range.

### Jira API Endpoints to Use
- `GET /rest/api/3/board/{boardId}/sprint` â€” list sprints per board
- `GET /rest/api/3/board/{boardId}/sprint/{sprintId}/issue` â€” issues in sprint
- `GET /rest/api/3/issue/{issueKey}/changelog` â€” status transition history
- `GET /rest/agile/1.0/board/{boardId}/version` â€” fix versions (releases)
- `GET /rest/api/3/project/{projectKey}/version` â€” project versions
- `GET /rest/api/3/issue/picker` + JQL â€” flexible issue queries
- `GET /rest/agile/1.0/board/{boardId}/roadmap` â€” native roadmap epics/initiatives
- `GET /rest/api/3/team` â€” Jira teams (when available via org API)

### Data Sync Strategy
- Poll Jira on a configurable schedule (default: every 30 minutes, cron via NestJS `@nestjs/schedule`)
- Cache raw responses in Postgres (entities: `JiraIssue`, `JiraSprint`, `JiraVersion`, `JiraChangelog`)
- Expose a `POST /api/sync` endpoint to trigger manual refresh
- Show last-synced timestamp in the UI header

---

## Auth

Single-user authentication using a static API key:
- Backend: Passport `HeaderAPIKeyStrategy` â€” validates `x-api-key` header against `APP_API_KEY` env var
- All API routes protected by `@UseGuards(ApiKeyAuthGuard)` except `GET /health` and Swagger
- Frontend: stores the key in `localStorage` on first entry, attaches it as a header on all requests
- Settings page allows the user to re-enter or clear the key

---

## DORA Metrics

### Deployment Frequency

**Definition:** Number of deployments per board per time period.

**Data source (in priority order):**
1. Jira Releases â€” issues with a `fixVersion` that has a `releaseDate` within the filter range
2. Issues transitioned to a "Done" status (configurable per board â€” default: `Done`, `Closed`, `Released`)

**Output:**
- Count per sprint or per quarter
- DORA band classification:
  - **Elite:** Multiple times per day
  - **High:** Once per day to once per week
  - **Medium:** Once per week to once per month
  - **Low:** Less than once per month

---

### Lead Time for Changes

**Definition:** Time from first commit / issue creation to deployed (Done or Released).

**Data source:** Issue `created` date â†’ date of transition to Done/Released status (from changelog).
For tickets with a `fixVersion`, use the version `releaseDate` as the end point.

**Calculation:** Median lead time across all issues deployed in the period.

**Output:**
- Median and p95 lead time (in days)
- DORA band classification:
  - **Elite:** < 1 hour (flag if data supports it; otherwise < 1 day)
  - **High:** 1 day â€“ 1 week
  - **Medium:** 1 week â€“ 1 month
  - **Low:** > 1 month

---

### Change Failure Rate (CFR)

**Definition:** Percentage of deployments that result in a failure requiring remediation.

**Configurable per board** â€” stored in `BoardConfig` entity. Config options:
- `failureIssueTypes`: array of issue types that represent failures (default: `["Bug", "Incident"]`)
- `failureLinkTypes`: Jira issue link types that indicate a failure caused by a deployment (default: `["is caused by", "caused by"]`)
- `failureLabels`: labels that flag a failure (default: `["regression", "incident", "hotfix"]`)

**Calculation:** `(failure issues linked to deployments in period / total deployments in period) * 100`

**Output:**
- Percentage per period
- DORA band classification:
  - **Elite:** 0â€“5%
  - **High:** 5â€“10%
  - **Medium:** 10â€“15%
  - **Low:** > 15%

---

### Mean Time to Recovery (MTTR)

**Definition:** Average time to recover from a failure.

**Configurable per board** â€” stored in `BoardConfig` entity. Config options:
- `incidentIssueTypes`: issue types that represent incidents/failures (default: `["Bug", "Incident"]`)
- `recoveryStatusName`: the status name that indicates recovery (default: `"Done"`, `"Resolved"`)
- `incidentLabels`: labels used to identify incidents

**Calculation:** For each failure issue in the period: `recoveryDate - failureCreatedDate` (median across all).

**Output:**
- Median MTTR in hours/days
- DORA band classification:
  - **Elite:** < 1 hour
  - **High:** < 1 day
  - **Medium:** < 1 week
  - **Low:** > 1 week

---

## Planning Accuracy Report

### Definition
Scope change per sprint â€” how much the sprint scope changed between sprint start and sprint end.

### Calculation
For each sprint:
- `added_mid_sprint`: issues added to the sprint after sprint start (created or moved in after `startDate`)
- `removed_mid_sprint`: issues removed from the sprint before completion
- `completed`: issues with Done status at sprint end
- `not_completed`: issues still open at sprint end (carried over)
- `scope_change_pct`: `((added + removed) / original_commitment) * 100`

**Original commitment** = issues in sprint at `startDate` snapshot (use changelog to reconstruct).

### Output per sprint
| Field | Description |
|---|---|
| Sprint Name | Sprint identifier |
| Commitment | Issues in sprint at start |
| Added | Issues added mid-sprint |
| Removed | Issues removed mid-sprint |
| Completed | Issues Done at end |
| Scope Change % | `(added + removed) / commitment * 100` |
| Completion Rate | `completed / (commitment + added - removed) * 100` |

> **Kanban (PLAT):** This report is not applicable for Kanban boards. Show a notice in the UI.

---

## Database Schema (TypeORM Entities)

### Core entities to generate:

```
BoardConfig           â€” board settings, CFR/MTTR rules, done status names
JiraSprint            â€” sprint metadata (id, name, state, startDate, endDate, boardId)
JiraIssue             â€” issue snapshot (key, summary, status, issueType, fixVersion, points, sprintId, createdAt, updatedAt)
JiraChangelog         â€” status transition history (issueKey, fromStatus, toStatus, changedAt)
JiraVersion           â€” fix versions / releases (id, name, releaseDate, projectKey)
SyncLog               â€” sync run history (boardId, syncedAt, issueCount, status)
```

---

## API Endpoints (NestJS)

```
GET  /health                            â€” health check (unguarded)
GET  /api-docs                          â€” Swagger UI (unguarded)

POST /api/sync                          â€” trigger full Jira sync
GET  /api/sync/status                   â€” last sync time per board

GET  /api/boards                        â€” list all configured boards
GET  /api/boards/:boardId/config        â€” get board config (CFR/MTTR rules)
PUT  /api/boards/:boardId/config        â€” update board config

GET  /api/metrics/dora                  â€” all 4 DORA metrics
  ?boardId=ACC,BPT,...                  (filter by board, comma-separated)
  &period=sprint|quarter
  &sprintId=123                         (if period=sprint)
  &quarter=2025-Q1                      (if period=quarter)

GET  /api/metrics/deployment-frequency  â€” Deployment Frequency detail
GET  /api/metrics/lead-time             â€” Lead Time for Changes detail
GET  /api/metrics/cfr                   â€” Change Failure Rate detail
GET  /api/metrics/mttr                  â€” MTTR detail

GET  /api/planning/accuracy             â€” Sprint planning accuracy
  ?boardId=ACC
  &sprintId=123                         (single sprint)
  &quarter=2025-Q1                      (all sprints in quarter)

GET  /api/planning/sprints              â€” list available sprints per board
GET  /api/planning/quarters             â€” list available quarters derived from sprint data
```

---

## Frontend Pages & Components

### `/dora` â€” DORA Dashboard
- Board selector (multi-select chips, defaults to all boards)
- Period selector: sprint dropdown or quarter dropdown
- Four metric cards in a 2Ã—2 grid, each showing:
  - Current value
  - DORA band badge (colour-coded: Elite=green, High=blue, Medium=amber, Low=red)
  - Trend sparkline (last 6 periods)
- Board-level breakdown table below each card
- Last synced timestamp + manual sync button in header

### `/planning` â€” Planning Accuracy Dashboard
- Board selector (single select, Kanban boards show disabled with tooltip)
- Sprint or quarter filter
- Summary stats: avg scope change %, avg completion rate
- Sprint-by-sprint table with conditional row colouring (>20% scope change = amber, >40% = red)
- Trend chart: scope change % over time

### `/settings` â€” Settings
- API key entry / update
- Per-board config editor:
  - CFR: failure issue types, failure labels, failure link types
  - MTTR: incident issue types, recovery status name, incident labels
  - Done status name(s) for deployment detection
- Save triggers `PUT /api/boards/:boardId/config`

### Shared Components
- `MetricCard` â€” value, band badge, sparkline, trend arrow
- `BandBadge` â€” Elite/High/Medium/Low with appropriate colour
- `BoardChip` â€” selectable board filter chip
- `SprintSelect` â€” dropdown of available sprints
- `QuarterSelect` â€” dropdown of available quarters
- `SyncStatus` â€” last synced time with refresh button
- `DataTable` â€” sortable table with conditional row styling

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

---

## DORA Band Classification Logic

Create a shared utility `src/metrics/dora-bands.ts` (used by both backend and frontend via a shared package or duplicated):

```typescript
export type DoraBand = 'elite' | 'high' | 'medium' | 'low'

export function classifyDeploymentFrequency(deploymentsPerDay: number): DoraBand { ... }
export function classifyLeadTime(medianDays: number): DoraBand { ... }
export function classifyChangeFailureRate(percentage: number): DoraBand { ... }
export function classifyMTTR(medianHours: number): DoraBand { ... }
```

---

## Testing Requirements

### Backend (Jest)
- Unit tests for all metric calculation services (mock Jira data fixtures)
- Unit tests for DORA band classification utility
- Integration tests for `/api/metrics/dora` endpoint (mock DB)
- Unit tests for planning accuracy calculation

### Frontend (Vitest)
- Unit tests for `MetricCard`, `BandBadge`, `DataTable` components
- Unit tests for Zustand stores
- Unit tests for DORA band classification utility (if duplicated on frontend)

---

## Copilot Implementation Sequence

Suggested build order for GitHub Copilot Workspace:

1. **Scaffold** â€” monorepo structure, Docker Compose, Makefile, `.env.example`
2. **Backend foundation** â€” NestJS app, TypeORM config, DB connection, health endpoint
3. **Auth** â€” Passport API key strategy, guard, middleware
4. **Database** â€” all entities + initial migration
5. **Jira client** â€” typed HTTP client wrapping Jira REST API v3 + Agile API
6. **Sync service** â€” scheduled + manual sync, `SyncLog` writes
7. **Metric services** â€” one service per DORA metric + DORA band classifier
8. **Planning service** â€” sprint scope change calculations
9. **API controllers** â€” all endpoints with Swagger decorators
10. **Frontend scaffold** â€” Next.js app, Tailwind v4, Zustand stores, API client
11. **Shared components** â€” `MetricCard`, `BandBadge`, `DataTable`, etc.
12. **DORA dashboard page**
13. **Planning accuracy page**
14. **Settings page**
15. **Tests** â€” backend Jest, frontend Vitest
16. **README** â€” setup, env config, Makefile usage

---

## Notes & Edge Cases

- **Kanban (PLAT):** No sprints exist. Deployment frequency and lead time should use a rolling
  date window derived from the selected quarter. Planning accuracy report must be hidden/disabled
  for Kanban boards with a clear UI message.
- **Missing fix versions:** Fall back to "moved to Done" as the deployment signal when no
  `fixVersion` is present on an issue.
- **Partial sprints:** Sprints in `active` state should be included but flagged as in-progress
  in the UI (e.g., an "Active" badge on the sprint row).
- **Empty boards:** If a board has never synced or has no data in the selected period, show
  an empty state card rather than zero values.
- **Changelog reconstruction:** Sprint membership at start date must be reconstructed from
  changelog entries â€” Jira does not expose a historical sprint snapshot directly.
- **Rate limiting:** Jira Cloud imposes API rate limits. The Jira client should implement
  exponential backoff with a max of 3 retries on 429 responses.
- **Throttler:** Apply `ThrottlerGuard` globally at 100 requests per minute per IP.