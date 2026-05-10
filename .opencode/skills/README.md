# OpenCode Skills

Opinionated OpenCode skills for structured software development with AI agents.

The skills are organised in two layers so they can target multiple stacks:

- **Core, language-agnostic rules** in [`RULES.md`](RULES.md): configuration & secrets,
  external HTTP clients (timeouts, retries), observability principles, infrastructure
  as code (OpenTofu/Terraform), TDD and testing, git & PRs.
- **Stack overlays** under [`rules/`](rules/), one per supported skillset. Each
  overlay refines the core for a specific stack (language conventions, framework
  rules, ORM, logger, test runner).

Selectable skillset profiles:

| Identifier | Overlay | Stack |
|---|---|---|
| [`typescript`](rules/typescript.md) | [`rules/typescript.md`](rules/typescript.md) | NestJS + Next.js + TypeORM + pino + Jest/Vitest (the original opinionated stack) |
| [`dotnet`](rules/dotnet.md) | [`rules/dotnet.md`](rules/dotnet.md) | ASP.NET Core + EF Core + Serilog + xUnit + FluentValidation |

The active profile for a project is pinned in its `CLAUDE.md` via the
`## Active Skillset` line — written automatically by `project-bootstrap` (interactive)
or `project-onboard` (auto-detects from `*.csproj` / `package.json` / etc.).

Bootstrap **defaults** per profile live in [`profiles/<profile>/bootstrap.md`](profiles/);
**scaffolder commands** in [`profiles/<profile>/scaffolders.md`](profiles/). To add a
new skillset (Python, Go, Rust, etc.), drop a directory under `profiles/`, add the
matching `rules/<profile>.md`, and skills pick it up — no skill code changes needed.

The conventions are deliberately strict (no raw env-var access outside the typed config
module, no `*` action on `*` resource, 5s default timeouts on external HTTP, standard
resource tags, TDD red-green-refactor, etc.) plus stack-specific rules (no `any`, no
`enum`, no `useEffect` for data fetching for `typescript`; nullable reference types on,
async-all-the-way, no `dynamic` for `dotnet`).

## Skills

| Name | Description |
|---|---|
| [architect](architect/SKILL.md) | Drives technical design decisions, writes proposals before significant changes, and maintains the proposal index |
| [developer](developer/SKILL.md) | Writes production-quality TypeScript following TDD (red-green-refactor) and project conventions |
| [reviewer](reviewer/SKILL.md) | Reviews staged changes for security, correctness, performance, IaC safety, observability, and convention adherence; returns a PASS / PASS WITH COMMENTS / BLOCK verdict with Acceptance Criteria traceability |
| [infosec](infosec/SKILL.md) | Read-only security and compliance audit (ISO27001-aligned by default). Audits encryption, access control, audit logging, secrets, IAM, network exposure, and supply chain. Returns APPROVED / REQUIRES CHANGES / APPROVED WITH EXCEPTION |
| [decision-log](decision-log/SKILL.md) | Sole owner of ADR creation. Captures and maintains architectural decisions in `docs/decisions/` with a running index; invoked by `architect` after a proposal is accepted |
| [create-feature](create-feature/SKILL.md) | Full feature development cycle: proposal → implementation → review → infosec sign-off → decision logging → PR |
| [jira-feature](jira-feature/SKILL.md) | Loads a Jira ticket by URL or issue key, extracts description and acceptance criteria, and drives the full create-feature cycle with that ticket as the requirement source |
| [project-bootstrap](project-bootstrap/SKILL.md) | Interactive bootstrap for new projects — asks structured questions covering app stack, IaC, observability, security/compliance, domain, and Jira integration, then produces a complete `CLAUDE.md` and populates the Project Context block in all local skills |
| [project-onboard](project-onboard/SKILL.md) | Interactive onboarding for an existing codebase — investigates the repo to fill in `CLAUDE.md` and the Project Context block, asking the user only what the code can't answer; covers the same 9 phases as project-bootstrap including optional Jira integration |
| [mcp-setup](mcp-setup/SKILL.md) | Interactive MCP server setup — presents a menu of available MCP servers (Context7, GitHub, Filesystem, Memory, Squirrel Notes, Semgrep, Jira) and writes the chosen config into `opencode.json`; invoked automatically by `project-bootstrap` and `project-onboard` |
| [create-skill](create-skill/SKILL.md) | Interactively creates or updates OpenCode skills — asks structured questions about purpose, workflow, MCP tools, and output format, then produces a complete SKILL.md and updates the README |
| [update-skills](update-skills/SKILL.md) | Pulls the latest skills from the upstream repository and reports what changed (added, removed, modified) with a unified diff per skill |

## Setup

### OpenCode (default)

Install the skills into your project with a single command run from your project root:

```bash
git clone --depth 1 https://github.com/garethrhughes/skills .opencode/skills && rm -rf .opencode/skills/.git
```

This copies the skills into `.opencode/skills/` inside your project, where OpenCode picks
them up automatically. The `.git` directory is removed so the skills folder is a plain
directory tracked by your own repository rather than a nested git repo.

### Claude Code

After cloning the skills repo (anywhere — defaults to `~/.config/opencode/skills`), run
from your project root:

```bash
~/.config/opencode/skills/scripts/install-claude-agents.sh
```

This writes one agent file per skill into `.claude/agents/<skill>.md` with the
appropriate per-skill tool restrictions, copies `RULES.md` alongside, and is safe to
re-run after `update-skills` pulls upstream changes.

### GitHub Copilot

```bash
~/.config/opencode/skills/scripts/install-copilot-agents.sh
```

Symlinks each `SKILL.md` into `.github/agents/<skill>.md` and copies `RULES.md`
alongside.

### Configure for your project

Once installed, configure the skills for your project by running either:

- **New project:** `Use the project-bootstrap skill to set up this project.`
- **Existing project:** `Use the project-onboard skill to onboard this existing codebase.`

Both skills will interview you (or read your codebase), produce a `CLAUDE.md`, populate
the `## Project Context` block in every skill, and guide you through MCP server setup.

## Usage

Reference a skill in any OpenCode prompt by name:

```
Use the architect skill to design a caching strategy for the sync module.
```

```
Use the developer skill to implement the feature described in proposal 0042.
```

```
Use the reviewer skill to review the staged changes in this branch.
```

```
Use the infosec skill to audit this PR for ISO27001 compliance and security issues.
```

```
Use the decision-log skill to log the decision made in the last conversation.
```

```
Use the create-feature skill to walk through the full feature cycle for this task.
```

```
Use the jira-feature skill with PROJ-123.
```

```
Use the project-bootstrap skill to set up this project.
```

```
Use the project-onboard skill to onboard this existing codebase.
```

```
Use the mcp-setup skill to configure MCP servers for this project.
```

```
Use the create-skill skill to create a new skill called my-skill.
```

```
Use the update-skills skill to update all skills to the latest version.
```

### jira-feature

Run this skill when you want to start a feature cycle directly from a Jira ticket. Provide
a ticket URL or issue key and the skill will fetch the summary, description, and acceptance
criteria, confirm the brief with you, then hand off to `create-feature` to run the full
proposal → implementation → review → infosec → decision log → PR cycle.

If the Jira MCP server is not configured, the skill will invoke `mcp-setup` automatically
to add it before proceeding.

```
Use the jira-feature skill with PROJ-123.
```

### mcp-setup

Run this skill to configure MCP servers for a project. It presents a menu of available
servers (Context7, GitHub, Filesystem, Memory, Squirrel Notes, Semgrep, Jira) and writes
the selected config into `opencode.json`, merging with any existing config. It is invoked
automatically as part of `project-bootstrap` and `project-onboard`, but can also be run
standalone at any time to add or reconfigure servers.

```
Use the mcp-setup skill to configure MCP servers for this project.
```

### project-bootstrap

Run this skill once when starting a **new project**. It walks through 9 phases covering
app stack, infrastructure, observability, security/compliance, domain decisions, and
optional Jira integration. Accept the opinionated defaults by saying "yes" or "default"
at any phase, or provide your own values. At the end it produces:

- A fully populated `CLAUDE.md` in the project root
- A `## Project Context` block automatically inserted into each skill in `.opencode/skills/`
- MCP server config written to `opencode.json` via `mcp-setup`

```
Use the project-bootstrap skill to set up this project.
```

### project-onboard

Run this skill once when **adopting an existing codebase**. Instead of interviewing you
from scratch, it reads the repo first — package files, config, IaC, CI/CD — and only asks
for what the code cannot answer. It covers the same 9 phases as `project-bootstrap`,
including optional Jira integration, and produces the same outputs:

- A fully populated `CLAUDE.md` in the project root
- A `## Project Context` block automatically inserted into each skill in `.opencode/skills/`
- MCP server config written to `opencode.json` via `mcp-setup`
- An **Onboarding Notes** section in `CLAUDE.md` listing gaps between the current code and the standard rules

```
Use the project-onboard skill to onboard this existing codebase.
```

## Customisation

Each skill contains a `## Project Context` section near the top. Running `project-bootstrap`
or `project-onboard` populates this automatically for every skill in `.opencode/skills/`.

To update it manually, edit the `## Project Context` section of the relevant SKILL.md
directly — changes are tracked in version control alongside your code.

> **Note:** in OpenCode, your project's `CLAUDE.md` is already loaded into every
> conversation automatically. The `## Project Context` section in each skill is for
> skill-specific overrides or additions beyond what `CLAUDE.md` already provides.

## CLAUDE.md Template

See [`CLAUDE.md.template`](CLAUDE.md.template) for a generic `CLAUDE.md` structure you can
copy into any new project and fill in manually, without running `project-bootstrap`.
