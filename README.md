# AI Starter

A full-stack TypeScript starter project.

## Stack

| Layer    | Technology                                          |
|----------|-----------------------------------------------------|
| Frontend | Next.js (App Router) + TypeScript + Tailwind CSS v4 |
| Backend  | NestJS + TypeScript + TypeORM                       |
| Database | PostgreSQL 16                                       |

**Ports:** Frontend `:3000` | Backend `:3001` | Database `:5432`

## Quick Start

```bash
# Install all dependencies
make install

# Start all services (Docker DB + backend + frontend)
make start

# Stop everything
make stop

# Wipe DB and re-run migrations
make clean

# Full rebuild from scratch
make reset
```

## Individual Services

```bash
# Backend
cd backend && npm run start:dev   # Dev with hot reload
cd backend && npm run build       # Build
cd backend && npm run test        # Unit tests
cd backend && npm run lint        # Lint

# Frontend
cd frontend && npm run dev        # Dev server
cd frontend && npm run build      # Production build
cd frontend && npm run test       # Unit tests (Vitest)
cd frontend && npm run lint       # Lint
```

## Migrations

```bash
cd backend
npm run migration:generate -- src/migrations/<Name>
npm run migration:create   -- src/migrations/<Name>
npm run migration:run
npm run migration:revert
```

## Environment

Copy `.env.example` to `.env` in both `backend/` and `frontend/` and fill in your values.
