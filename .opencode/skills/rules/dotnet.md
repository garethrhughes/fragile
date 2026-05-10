# .NET Stack Overlay

**Stack:** C# + ASP.NET Core (backend) + EF Core + PostgreSQL/SQL Server; optional Blazor or SPA frontend
**Activated when:** the project's `CLAUDE.md` declares `## Active Skillset: dotnet`

This file is a stack-specific overlay on top of the language-agnostic
[`RULES.md`](../RULES.md). Where this file and `RULES.md` overlap, this file wins for
.NET projects.

---

## C# Conventions

- **Nullable reference types ON** project-wide (`<Nullable>enable</Nullable>`).
  Treat nullable warnings as errors.
- **`record` for DTOs and value objects.** Mutable `class` only when entity identity
  or framework requires it.
- **`sealed` by default** on classes that are not designed for inheritance.
- **File-scoped namespaces** (`namespace Foo.Bar;`).
- **No `dynamic`** outside narrow interop scenarios — and document why.
- **Async all the way.** No `.Result`, `.Wait()`, `GetAwaiter().GetResult()` outside
  `Program.cs` startup. Suffix async methods with `Async`. Pass `CancellationToken`
  through every public async API.
- **`var` only when the type is obvious from the right-hand side**; otherwise use the
  explicit type.
- **Treat warnings as errors** (`<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`).
- **No `#region`** to hide complexity — refactor instead.

---

## Configuration & Secrets (.NET-specific)

Inherits the principles in [`RULES.md#configuration--secrets`](../RULES.md#configuration--secrets).
Stack-specific implementation:

- All configuration access goes through **`IOptions<T>` / `IOptionsSnapshot<T>` /
  `IOptionsMonitor<T>`** bound from `IConfiguration` at startup.
- **`Environment.GetEnvironmentVariable` must never be called outside `Program.cs`
  startup.** Any other read is a violation.
- **Dev secrets:** `dotnet user-secrets`. **Prod secrets:** AWS Secrets Manager / Azure
  Key Vault, loaded via the appropriate configuration provider.
- **`appsettings.json`** for non-secret defaults; `appsettings.{Environment}.json` for
  per-env overrides; never commit `appsettings.Production.json` with real values.
- Validate options at startup with `.ValidateDataAnnotations().ValidateOnStart()` so
  misconfiguration fails fast.
- Lockfile (`packages.lock.json`) is committed; CI restores with
  `dotnet restore --locked-mode`.

---

## External HTTP Clients (.NET-specific)

Inherits the principles in [`RULES.md#external-http-clients`](../RULES.md#external-http-clients).
Stack-specific implementation:

- **`IHttpClientFactory` only.** No `new HttpClient()` anywhere.
- Register a **typed client per external service**
  (`services.AddHttpClient<IFooClient, FooClient>()`). Domain services never call
  `HttpClient` directly.
- Compose **Polly** policies for timeout (default 5s), exponential-backoff retry with
  jitter, and circuit breaker via `AddTransientHttpErrorPolicy` /
  `AddPolicyHandler`.
- Validate external responses at the boundary (FluentValidation or DataAnnotations on
  the response DTO) before entering domain code.

---

## Backend Rules (ASP.NET Core)

- **Thin controllers / Minimal API endpoints.** They parse, validate, and delegate.
  Business logic lives in services registered with DI.
- **DTO validation at the boundary** with FluentValidation (preferred) or
  DataAnnotations + `[ApiController]` automatic model-state validation.
- **Repositories own all persistence.** Services never write LINQ-to-EF queries or
  call `DbContext` directly outside repositories.
- **Auth and audit logging via middleware / authorization filters / endpoint filters**
  — never inline `if (User.IsInRole(...))` checks scattered through handlers.
- **Use `[ApiController]`** on controller-based APIs for automatic 400 responses and
  binding-source inference.
- **`ProblemDetails`** for error responses (`AddProblemDetails()` + an exception
  handler middleware).
- **EF Core:** migrations live in a dedicated project; every migration has both `Up`
  and `Down`. No `EnsureCreated` in production startup. No `AsNoTracking()` omitted on
  read-only queries.

---

## Frontend Rules

If the frontend is **Blazor**:

- Components own rendering; business logic lives in injected services, not in
  `@code { }` blocks.
- All HTTP calls go through a typed client registered with `IHttpClientFactory`,
  never raw `HttpClient` in components.
- Every async UI path has explicit loading and error states.
- No direct DOM manipulation via `IJSRuntime` outside thin interop wrappers.

If the frontend is a **SPA (React/Vue/Svelte) backed by an ASP.NET Core API**:

- `dotnet` remains the **active overlay** for the project (a single overlay is active
  per project today). When working on the SPA half, additionally consult
  [`rules/typescript.md`](typescript.md) — *Frontend Rules* and *TypeScript
  Conventions* — as a secondary reference. Multi-overlay activation is a future
  enhancement.

---

## Logging (.NET-specific)

Inherits the principles in [`RULES.md#logging--observability`](../RULES.md#logging--observability).
Stack-specific implementation:

- **Serilog** as the logging provider, configured via `appsettings.json` and
  `UseSerilog()`. JSON sink (CompactJsonFormatter or
  `Serilog.Formatting.Compact.RenderedCompactJsonFormatter`) in production.
- **`LogContext`** carries the correlation ID for the lifetime of the request,
  populated by middleware at the request entry point.
- **Source-generated loggers** (`[LoggerMessage]`) for hot paths; `ILogger<T>`
  everywhere else.
- No `Console.WriteLine` in production code paths.

---

## Testing (.NET-specific)

Inherits the principles in [`RULES.md#testing`](../RULES.md#testing). Stack-specific
implementation:

- **xUnit** as the test runner. **FluentAssertions** for assertions.
- **Integration tests** via `WebApplicationFactory<TProgram>` against an in-process
  host; database-backed tests use Testcontainers (PostgreSQL/SQL Server) — never an
  in-memory provider for behaviour parity.
- **Mocking:** NSubstitute (preferred) or Moq, at boundaries only. Do not mock the
  system under test.
- Tests live in a sibling `*.Tests` project per production project.
