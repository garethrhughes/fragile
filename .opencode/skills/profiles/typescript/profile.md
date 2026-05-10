# TypeScript Profile

**Identifier:** `typescript`
**Overlay:** [`rules/typescript.md`](../../rules/typescript.md)

The opinionated reference stack the skills were originally built around.

| Concern | Choice |
|---|---|
| Backend framework | NestJS 11 |
| Backend language | TypeScript (strict mode) |
| Database | PostgreSQL 16 |
| ORM | TypeORM (CLI migrations) |
| Auth | JWT bearer (15-minute access + refresh rotation) |
| API docs | Swagger via `@nestjs/swagger` |
| Validation | class-validator + class-transformer |
| Logging | pino (JSON, request-scoped child loggers) |
| Backend testing | Jest + Supertest |
| Frontend framework | Next.js 16 (App Router) + React 19 |
| Styling | Tailwind CSS v4 |
| State | Zustand |
| Frontend testing | Vitest + React Testing Library |
| HTTP client | Typed `fetch` wrappers in `lib/api.ts` |
| Local dev | Docker Compose (PostgreSQL 16, port 5432) |
| Deploy target | AWS — ECS Fargate + CloudFront + WAF + ECR + RDS |
| IaC | OpenTofu 1.8 |
| IaC state | S3 + DynamoDB lock |
| Secrets | AWS Secrets Manager |
| CI/CD | GitHub Actions |
| Task runner | Makefile |

Auto-detect signals (used by `project-onboard`):

- `package.json` containing `next`, `@nestjs/*`, or `typeorm`
- `tsconfig.json` at the repo root
