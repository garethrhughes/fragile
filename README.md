# Jira DORA & Planning Metrics Dashboard

Internal engineering metrics dashboard that reads data from Jira Cloud and produces
DORA metrics reports and sprint planning accuracy reports.

## Stack

| Layer    | Technology                                                    |
|----------|---------------------------------------------------------------|
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind CSS v4 + Zustand |
| Backend  | NestJS 11 + TypeScript + TypeORM + Passport.js                |
| Database | PostgreSQL 16                                                 |

**Ports:** Frontend `:3000` | Backend `:3001` | Database `:5432`

## Quick Start

```bash
# 1. Copy env files and fill in your Jira credentials
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 2. Install dependencies
make install

# 3. Start PostgreSQL
make up

# 4. Run migrations
make migrate

# 5. Start dev servers (in separate terminals)
make dev-api
make dev-web
```

## Environment Variables

### Backend (`backend/.env`)
| Variable | Description |
|---|---|
| `JIRA_BASE_URL` | Jira Cloud base URL (e.g. `https://your-org.atlassian.net`) |
| `JIRA_USER_EMAIL` | Jira account email |
| `JIRA_API_TOKEN` | Jira API token |
| `JIRA_BOARD_IDS` | Comma-separated board keys (e.g. `ACC,BPT,SPS,OCS,DATA,PLAT`) |
| `APP_API_KEY` | Dashboard API key for authentication |
| `DB_HOST` | PostgreSQL host (default: `localhost`) |
| `DB_PORT` | PostgreSQL port (default: `5432`) |
| `DB_USERNAME` | PostgreSQL user (default: `postgres`) |
| `DB_PASSWORD` | PostgreSQL password (default: `postgres`) |
| `DB_DATABASE` | PostgreSQL database (default: `ai_starter`) |
| `PORT` | Backend port (default: `3001`) |
| `FRONTEND_URL` | Frontend URL for CORS (default: `http://localhost:3000`) |

### Frontend (`frontend/.env`)
| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend API URL (default: `http://localhost:3001`) |

## Makefile Targets

| Target | Description |
|---|---|
| `make install` | Install npm dependencies for backend and frontend |
| `make up` | Start PostgreSQL via Docker Compose |
| `make down` | Stop Docker Compose |
| `make migrate` | Build backend and run TypeORM migrations |
| `make seed` | Seed default board configurations |
| `make dev-api` | Start NestJS in watch mode |
| `make dev-web` | Start Next.js dev server |
| `make test-api` | Run backend Jest tests |
| `make test-web` | Run frontend Vitest tests |
| `make sync` | Trigger manual Jira data sync via API |
| `make start` | Start everything (Docker + backend + frontend) |
| `make stop` | Stop everything |
| `make clean` | Wipe DB and re-run migrations |
| `make reset` | Full rebuild from scratch |

## API Documentation

Swagger UI is available at [http://localhost:3001/api-docs](http://localhost:3001/api-docs) when the backend is running.

All API endpoints require the `x-api-key` header (except `/health` and `/api-docs`).

## Boards

| Board Key | Type |
|---|---|
| ACC | Scrum |
| BPT | Scrum |
| SPS | Scrum |
| OCS | Scrum |
| DATA | Scrum |
| PLAT | Kanban |

**Note:** Kanban boards (PLAT) have no sprints. Planning accuracy is not available for Kanban boards.

## DORA Metrics

- **Deployment Frequency** — deployments per day (Elite: multiple/day, High: daily–weekly, Medium: weekly–monthly, Low: <monthly)
- **Lead Time for Changes** — median days from issue creation to done (Elite: <1 day, High: 1d–1w, Medium: 1w–1m, Low: >1m)
- **Change Failure Rate** — % of deployments causing failures (Elite: 0–5%, High: 5–10%, Medium: 10–15%, Low: >15%)
- **Mean Time to Recovery** — median hours to recover (Elite: <1h, High: <1d, Medium: <1w, Low: >1w)

## Migrations

```bash
cd backend
npm run migration:generate -- src/migrations/<Name>
npm run migration:run
npm run migration:revert
```
