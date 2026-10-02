# .NET Profile

**Identifier:** `dotnet`
**Overlay:** [`rules/dotnet.md`](../../rules/dotnet.md)

A parallel profile for projects building on the .NET stack.

| Concern | Choice |
|---|---|
| Backend framework | ASP.NET Core 9 (controller-based Web API) |
| Backend language | C# 13 with nullable reference types ON |
| Database | PostgreSQL 16 (or SQL Server 2022) |
| ORM | EF Core 9 (code-first migrations) |
| Auth | JWT bearer via `Microsoft.AspNetCore.Authentication.JwtBearer` (15-min access + refresh rotation) |
| API docs | OpenAPI via `Microsoft.AspNetCore.OpenApi` + Swagger UI |
| Validation | FluentValidation |
| Logging | Serilog (JSON sink, `LogContext` for correlation IDs) |
| Backend testing | xUnit + FluentAssertions + `WebApplicationFactory<TProgram>` + Testcontainers |
| Frontend framework | Optional — Blazor Server, Blazor WASM, or a separate SPA (see TypeScript profile for SPA half) |
| Local dev | Docker Compose (PostgreSQL 16, port 5432) |
| Deploy target | AWS — ECS Fargate + CloudFront + WAF + ECR + RDS (or Azure App Service + Azure SQL — pick per project) |
| IaC | OpenTofu 1.8 |
| IaC state | S3 + DynamoDB lock (or Azure Storage with blob lease) |
| Secrets | AWS Secrets Manager (or Azure Key Vault) — loaded via the appropriate configuration provider; `dotnet user-secrets` in dev |
| CI/CD | GitHub Actions |
| Task runner | Makefile (or `dotnet` CLI directly) |

Auto-detect signals (used by `project-onboard`):

- Any `*.csproj`, `*.sln`, or `global.json` at the repo root or under `src/`
- `Directory.Build.props` or `Directory.Packages.props`
- `appsettings.json` adjacent to a project file
