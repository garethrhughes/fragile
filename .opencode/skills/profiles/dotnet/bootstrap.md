# .NET Profile — Bootstrap Defaults

These are the default answers `project-bootstrap` and `project-onboard` propose when
the user selects the **dotnet** profile. The user can accept the default or override.

---

## Phase 2 — Application Tech Stack

### Round A — Backend

| # | Question | Default |
|---|---|---|
| 2A.1 | Backend framework + language | ASP.NET Core 9 (controller-based Web API) + C# 13 with nullable reference types ON |
| 2A.2 | Database + ORM | PostgreSQL 16 + EF Core 9 (code-first migrations via `dotnet ef migrations`) |
| 2A.3 | Authentication | JWT bearer via `Microsoft.AspNetCore.Authentication.JwtBearer`, 15-min access + 7-day refresh rotation. For internal-only tools, override with "None at application level — CORS / WAF as sole access control" |
| 2A.4 | API docs | `Microsoft.AspNetCore.OpenApi` + Swagger UI at `/swagger`, unguarded in non-prod |
| 2A.5 | Backend testing framework | xUnit + FluentAssertions + `WebApplicationFactory<TProgram>` (integration) + Testcontainers (DB) |
| 2A.6 | Schema migrations | EF Core CLI — `dotnet ef migrations add <Name>` / `dotnet ef database update`; every migration must implement both `Up` and `Down` |
| 2A.7 | DTO validation | FluentValidation registered via `services.AddValidatorsFromAssemblyContaining<…>()` and wired through an endpoint filter / action filter |
| 2A.8 | Logging library | Serilog — JSON CompactJsonFormatter sink, `UseSerilog()`, `LogContext` for correlation IDs populated by request middleware |

### Round B — Frontend (skip if backend-only)

| # | Question | Default |
|---|---|---|
| 2B.1 | Frontend framework | None by default. Common opt-ins: Blazor Server, Blazor WASM, or a separate Next.js SPA (in which case the TypeScript overlay also applies) |
| 2B.2 | Styling (if Blazor) | Tailwind CSS v4 via the standard standalone CLI, integrated through the `wwwroot/` build pipeline |
| 2B.3 | State (if Blazor) | Scoped DI services for shared state; `Fluxor` only when state truly needs Redux-style flows |
| 2B.4 | Frontend testing (if Blazor) | bUnit + xUnit |
| 2B.5 | API access (if separate SPA) | Typed client per backend, generated from OpenAPI (NSwag or Kiota) |

---

## Phase 3 — IaC & Deployment

| # | Question | Default |
|---|---|---|
| 3.1 | Local dev | Docker Compose — PostgreSQL 16, port 5432 |
| 3.2 | Deploy target | AWS — ECS Fargate behind CloudFront + WAF, ECR for images, RDS for PostgreSQL. Common alternative: Azure App Service + Azure SQL |
| 3.3 | IaC tool | OpenTofu 1.8 |
| 3.4 | IaC state | S3 bucket with DynamoDB lock (or Azure Storage + blob lease for Azure deploys); one state file per environment |
| 3.5 | IaC layout | `infra/modules/` for reusable modules; `infra/envs/{dev,staging,prod}/` for env root configs |
| 3.6 | Secrets manager | AWS Secrets Manager (or Azure Key Vault); loaded via the matching `IConfiguration` provider. `dotnet user-secrets` for local dev |
| 3.7 | CI/CD | GitHub Actions — `dotnet restore --locked-mode && dotnet build && dotnet test` on PR; container build + `apply` on merge to `main` for dev, manual approval for staging/prod |
| 3.8 | Standard tags | Use `RULES.md#infrastructure-as-code` defaults |
| 3.9 | Config management | `appsettings.json` for non-secret defaults; `appsettings.{Environment}.json` for per-env overrides; `dotnet user-secrets` in dev; production config sourced from the secrets manager. Backend reads via `IOptions<T>` only |
| 3.10 | Task runner | Makefile delegating to the `dotnet` CLI — targets: `up`, `down`, `migrate`, `dev-api`, `test-api`, `build`, `plan`, `apply` |

---

## Phase 4 — Repository Structure

| # | Question | Default |
|---|---|---|
| 4.1 | Layout | Single solution; monorepo if a frontend is also present |
| 4.2 | Top-level dirs | `src/`, `tests/`, `infra/modules/`, `infra/envs/`, `docs/`, `scripts/`. The `*.sln` lives at the repo root |
| 4.3 | Solution layout | `src/<Project>.Api/` (host), `src/<Project>.Application/` (services + DTOs), `src/<Project>.Domain/` (entities + domain rules), `src/<Project>.Infrastructure/` (EF Core, external clients) |
| 4.4 | Test layout | `tests/<Project>.Api.Tests/`, `tests/<Project>.Application.Tests/`, `tests/<Project>.IntegrationTests/` |
| 4.5 | Infra internals | `modules/{network,compute,data,observability}/`, `envs/{dev,staging,prod}/` |
| 4.6 | Docs | `docs/proposals/` and `docs/decisions/` |

---

## Phase 6 — Observability

| # | Question | Default |
|---|---|---|
| 6.1 | Logging backend | CloudWatch Logs via container stdout/stderr — Serilog JSON ingested as-is; 30-day dev / 90-day prod |
| 6.2 | Metrics backend | CloudWatch Metrics — `System.Diagnostics.Metrics` exported via OpenTelemetry to the CloudWatch EMF exporter |
| 6.3 | Tracing backend | AWS X-Ray via OpenTelemetry .NET SDK, sampling 10% prod / 100% dev |
| 6.4 | SLIs | HTTP latency p50/p95/p99, error rate (4xx/5xx), CPU/memory saturation, EF Core command duration, external dependency latency |
| 6.5 | Alerting | CloudWatch alarms: error rate >1% over 5min, p99 latency >2s over 5min, deployment failure |

---

## Phase 7 — Security & Compliance

| # | Question | Default |
|---|---|---|
| 7.1 | Compliance framework | None by default; common opt-ins: ISO27001:2022, SOC2 Type 2, HIPAA, PCI-DSS |
| 7.2 | Data classification | `public` / `internal` / `confidential` / `pii` |
| 7.3 | Encryption at rest | Provider-managed (AES-256) for RDS/Azure SQL, S3/Blob, EBS; customer-managed keys for `confidential` or `pii` data |
| 7.4 | Encryption in transit | TLS 1.2 minimum, TLS 1.3 preferred; HTTPS everywhere; HSTS set; Kestrel configured with `RequireHttps` |
| 7.5 | Auth model | JWT 15min access + 7-day refresh; rotation on use; revocation on logout/password change; rate-limit on `/auth/login` (5/min/IP) via the built-in rate limiter |
| 7.6 | Public endpoints | `GET /health`, `GET /swagger` (non-prod) only; everything else requires auth |
| 7.7 | Network exposure | No `0.0.0.0/0` ingress except 443 on the public load balancer; databases never have public IPs; internal services behind WAF |
| 7.8 | Vulnerability scanning | Dependabot for NuGet + Terraform providers; `dotnet list package --vulnerable --include-transitive` in CI; Trivy on container images |
| 7.9 | Audit logging | Auth events (success + failure), API key lifecycle, role changes, data exports, admin actions, soft/hard deletes; retain ≥1 year |
