# TypeScript Profile — Bootstrap Defaults

These are the default answers `project-bootstrap` and `project-onboard` propose when
the user selects the **typescript** profile. Each row corresponds to a question in
the relevant phase. The user can accept the default ("yes" / "default" / Enter) or
override.

---

## Phase 2 — Application Tech Stack

### Round A — Backend

| # | Question | Default |
|---|---|---|
| 2A.1 | Backend framework + language | NestJS 11 + TypeScript strict mode |
| 2A.2 | Database + ORM/data layer | PostgreSQL 16 + TypeORM (CLI migrations) |
| 2A.3 | Authentication | JWT bearer tokens with 15-minute access + refresh token rotation. For internal-only tools, override with "None at application level — CORS / WAF as sole access control" |
| 2A.4 | API docs | Swagger via `@nestjs/swagger` — served at `/api-docs`, unguarded |
| 2A.5 | Backend testing framework | Jest + Supertest |
| 2A.6 | Schema migrations | TypeORM CLI — `npm run migration:run`; migrations must implement both `up()` and `down()` |
| 2A.7 | DTO validation | class-validator + class-transformer |
| 2A.8 | Logging library | pino — JSON structured logs, request-scoped child loggers with correlation ID |

### Round B — Frontend (skip if backend-only)

| # | Question | Default |
|---|---|---|
| 2B.1 | Frontend framework | Next.js 16 (App Router) + React 19 |
| 2B.2 | Styling | Tailwind CSS v4 — CSS-first config via `@theme` in `globals.css`; no `tailwind.config.js` |
| 2B.3 | State management | Zustand — one store file per concern in `store/` |
| 2B.4 | Frontend testing | Vitest + React Testing Library |
| 2B.5 | API access | Typed `fetch` wrappers in `lib/api.ts` — no direct fetch calls outside this file |
| 2B.6 | Data fetching | Server Components first, React Query for client-side fetching, never `useEffect` |

---

## Phase 3 — IaC & Deployment

| # | Question | Default |
|---|---|---|
| 3.1 | Local dev | Docker Compose — PostgreSQL 16, port 5432 |
| 3.2 | Deploy target | AWS — ECS Fargate behind CloudFront + WAF, ECR for images, RDS for PostgreSQL |
| 3.3 | IaC tool | OpenTofu 1.8 (Terraform-compatible, open-source) |
| 3.4 | IaC state | S3 bucket with DynamoDB lock table; one state file per environment; separate AWS accounts for prod where feasible |
| 3.5 | IaC layout | `infra/modules/` for reusable modules; `infra/envs/{dev,staging,prod}/` for env root configs |
| 3.6 | Secrets manager | AWS Secrets Manager — referenced by ARN; no values in `.tf`/`.tfvars`/state |
| 3.7 | CI/CD | GitHub Actions — `lint + test + plan` on PR; `apply` on merge to `main` for dev, manual approval for staging/prod |
| 3.8 | Standard tags | Use `RULES.md#infrastructure-as-code` defaults |
| 3.9 | Config management | `.env` files (never committed); `.env.example` provided; backend reads via `ConfigService` only; production env vars sourced from Secrets Manager via task definition |
| 3.10 | Task runner | Makefile — targets: `up`, `down`, `migrate`, `dev-api`, `dev-web`, `test-api`, `test-web`, `plan`, `apply` |

---

## Phase 4 — Repository Structure

| # | Question | Default |
|---|---|---|
| 4.1 | Layout | Monorepo |
| 4.2 | Top-level dirs | `backend/`, `frontend/`, `infra/modules/`, `infra/envs/`, `docs/`, `scripts/` — plus `apps/` for auxiliary services |
| 4.3 | Backend internals | One NestJS module per feature domain, each with `*.controller.ts`, `*.service.ts`, `*.module.ts`, `dto/`. Shared: `database/entities/`, `database/migrations/`, `config/`, `common/` |
| 4.4 | Frontend internals | `app/` (App Router pages), `components/ui/`, `components/layout/`, `store/`, `lib/`, `hooks/` |
| 4.5 | Infra internals | `modules/{network,compute,data,observability}/`, `envs/{dev,staging,prod}/` |
| 4.6 | Docs | `docs/proposals/` and `docs/decisions/` |

---

## Phase 6 — Observability

| # | Question | Default |
|---|---|---|
| 6.1 | Logging backend | CloudWatch Logs via container stdout/stderr — pino JSON ingested as-is; 30-day dev / 90-day prod retention |
| 6.2 | Metrics backend | CloudWatch Metrics — custom metrics via embedded metric format (EMF) |
| 6.3 | Tracing backend | AWS X-Ray via OpenTelemetry, sampling 10% prod / 100% dev |
| 6.4 | SLIs | HTTP latency p50/p95/p99, error rate (4xx/5xx), CPU/memory saturation, external dependency latency |
| 6.5 | Alerting | CloudWatch alarms: error rate >1% over 5min, p99 latency >2s over 5min, deployment failure |

---

## Phase 7 — Security & Compliance

| # | Question | Default |
|---|---|---|
| 7.1 | Compliance framework | None by default; common opt-ins: ISO27001:2022, SOC2 Type 2, HIPAA, PCI-DSS |
| 7.2 | Data classification | `public` / `internal` / `confidential` / `pii` |
| 7.3 | Encryption at rest | Provider-managed (AES-256) for RDS, S3, EBS; customer-managed KMS for `confidential` or `pii` data |
| 7.4 | Encryption in transit | TLS 1.2 minimum, TLS 1.3 preferred; HTTPS everywhere; HSTS set |
| 7.5 | Auth model | JWT 15min access + 7-day refresh; rotation on use; revocation on logout/password change; 5 login attempts/min/IP |
| 7.6 | Public endpoints | `GET /health` and `GET /api-docs` only; everything else requires auth |
| 7.7 | Network exposure | No `0.0.0.0/0` ingress except 443 on the public load balancer; databases never have public IPs; internal services behind WAF |
| 7.8 | Vulnerability scanning | Dependabot for npm + Terraform providers; `npm audit --omit=dev` in CI; Trivy on container images |
| 7.9 | Audit logging | Auth events (success + failure), API key lifecycle, role changes, data exports, admin actions, soft/hard deletes; retain ≥1 year |
