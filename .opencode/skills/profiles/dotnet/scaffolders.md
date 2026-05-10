# .NET Profile — Scaffolders

Used by `project-bootstrap` Step 3.1 ("Prefer official scaffolders").

| Asset | Command |
|---|---|
| Solution | `dotnet new sln -n <Project>` |
| Web API (controller-based) | `dotnet new webapi -n <Project>.Api --use-controllers` |
| Web API (Minimal API) | `dotnet new webapi -n <Project>.Api` |
| Class library | `dotnet new classlib -n <Project>.Application` (repeat for `Domain`, `Infrastructure`) |
| xUnit test project | `dotnet new xunit -n <Project>.Tests` |
| Blazor Server | `dotnet new blazorserver -n <Project>.Web` |
| Blazor WASM | `dotnet new blazorwasm -n <Project>.Web` |
| EF Core tooling | `dotnet tool install --global dotnet-ef` (once per machine) |
| Add to solution | `dotnet sln add src/<Project>.Api/<Project>.Api.csproj` (repeat per project) |

After scaffolding, layer on:

- `Directory.Build.props` at the repo root with `<Nullable>enable</Nullable>`,
  `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`,
  `<LangVersion>latest</LangVersion>`,
  `<ImplicitUsings>enable</ImplicitUsings>`.
- `Directory.Packages.props` with `<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>`
  for centrally pinned versions.
- `.editorconfig` enabling the .NET analyzers ruleset and code style rules.
- `dotnet new gitignore` at the repo root.
- `dotnet restore --use-lock-file` to generate `packages.lock.json`; commit it.

**Lint/format:**

- `dotnet format` (built in) — run as a CI gate. Configuration via `.editorconfig`.
- Optional: `Roslynator.Analyzers` and `Microsoft.CodeAnalysis.NetAnalyzers` for
  additional rules.

**Smoke test commands:**

- Restore: `dotnet restore --locked-mode`
- Build: `dotnet build --configuration Release --no-restore`
- Test: `dotnet test --configuration Release --no-build`
- Format check: `dotnet format --verify-no-changes`
- Run: `dotnet run --project src/<Project>.Api`
- Migrations: `dotnet ef database update --project src/<Project>.Infrastructure --startup-project src/<Project>.Api`
