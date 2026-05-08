# @fragile.app/mcp

MCP (Model Context Protocol) server for the [Fragile](https://github.com/your-org/fragile)
engineering metrics dashboard. Exposes 29 tools (16 read-only metrics tools + 13 custom
report management tools), 2 resources, and 4 prompt templates over stdio — compatible with
Claude Desktop, Cursor, GitHub Copilot agent mode, and any other MCP-compatible AI client.

## What it does

Fragile caches Jira data in PostgreSQL and computes DORA metrics, sprint planning accuracy,
cycle time, roadmap coverage, and hygiene gaps. This MCP server gives AI assistants direct,
typed access to all of that data — no manual API calls required.

## Quick start

```bash
npx -y @fragile.app/mcp
```

The server reads two environment variables:

| Variable | Required | Description |
|---|---|---|
| `API_BASE_URL` | **Yes** | Base URL of the Fragile API, e.g. `https://api.your-fragile-domain.com` |
| `API_KEY` | No | API key for authentication if re-enabled. Leave unset for unauthenticated deployments. |

## Claude Desktop setup

Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "fragile": {
      "command": "npx",
      "args": ["-y", "@fragile.app/mcp"],
      "env": {
        "API_BASE_URL": "https://api.your-fragile-domain.com",
        "API_KEY": "optional-api-key"
      }
    }
  }
}
```

Restart Claude Desktop. The Fragile tools will appear in the tool picker.

## Cursor setup

Add the following to `.cursor/mcp.json` in your home directory or project root:

```json
{
  "mcpServers": {
    "fragile": {
      "command": "npx",
      "args": ["-y", "@fragile.app/mcp"],
      "env": {
        "API_BASE_URL": "https://api.your-fragile-domain.com"
      }
    }
  }
}
```

## Available tools

| Tool | Description |
|---|---|
| `get_dora_metrics` | DORA metrics aggregate for a quarter |
| `get_dora_trend` | DORA trend across multiple quarters |
| `get_snapshot_status` | Whether DORA snapshots are up to date |
| `get_planning_accuracy` | Sprint planning accuracy (Scrum boards only) |
| `list_sprints` | Available sprints for a board |
| `list_quarters` | All quarters with data |
| `get_cycle_time` | Cycle time percentiles for a board |
| `get_cycle_time_trend` | Cycle time trend |
| `get_sprint_detail` | Ticket-level sprint classification |
| `get_sprint_report` | Composite sprint report with recommendations |
| `get_roadmap_accuracy` | Roadmap coverage accuracy |
| `list_boards` | All configured boards |
| `get_board_config` | Full board configuration |
| `get_sync_status` | Last sync time per board |
| `get_hygiene_gaps` | Issues missing epic links or story points |
| `get_unplanned_done` | Issues completed without being planned |

### Custom report management tools

| Tool | Description |
|---|---|
| `list_custom_reports` | List all custom reports (id, slug, title, timestamps) |
| `get_custom_report` | Get a report by slug, including widgets, data points, and filters |
| `create_custom_report` | Create a new custom report with optional grid layout configuration |
| `update_custom_report` | Update title, description, or layout of an existing report |
| `delete_custom_report` | Delete a report and all its widgets, data points, and filters |
| `add_custom_report_widget` | Add a widget (line, bar, area, table, stat) to a report |
| `update_custom_report_widget` | Update an existing widget |
| `delete_custom_report_widget` | Delete a widget and its data points |
| `append_custom_report_data` | Append data points to a widget (additive, max 1000/call) |
| `replace_custom_report_data` | Replace all data points for a widget |
| `clear_custom_report_data` | Delete all data points without removing the widget |
| `add_custom_report_filter` | Add a filter definition (select or multiselect) to a report |
| `delete_custom_report_filter` | Remove a filter definition from a report |

### Layout configuration

The `create_custom_report` and `update_custom_report` tools accept an optional `layout` object:

```json
{
  "defaultColumns": 3,
  "widgets": {
    "<widget-uuid>": { "colSpan": 2 }
  }
}
```

- `defaultColumns` (1–6): number of grid columns. Defaults to 3.
- `widgets`: per-widget overrides keyed by widget UUID. `colSpan` (1–6) controls how many columns the widget occupies. Table widgets default to full-width (`colSpan = defaultColumns`) unless overridden.

## Available resources

| Resource | Description |
|---|---|
| `boards://list` | Summary of all configured boards |
| `boards://{boardId}/config` | Full configuration for a single board |

## Prompt templates

| Prompt | Description |
|---|---|
| `dora_health_report` | Full DORA health report for a quarter |
| `sprint_retrospective` | Sprint retrospective with planning accuracy and ticket breakdown |
| `release_readiness` | Release readiness assessment combining sprint health, DORA, and hygiene |
| `quarterly_planning_review` | Cross-board planning accuracy review for engineering leadership |

## Local development

```bash
cd apps/mcp
npm install
npm run build   # compile TypeScript to dist/
npm test        # run Vitest unit tests
```

## Publishing

The package is published automatically via GitHub Actions on every push to `main` that
changes files under `apps/mcp/**`. Publishing is skipped if the current version in
`package.json` is already present on npm, so a version bump is required to trigger a
new release.

To publish a new version:
1. Bump the version in `apps/mcp/package.json` (`npm version patch`, `minor`, or `major`).
2. Commit and push to `main` (or merge a PR that includes the version bump).

GitHub Actions will detect the new version, build the package, and publish it to npm.

```bash
# example — bump patch version locally before opening a PR
cd apps/mcp
npm version patch
```

The GitHub Actions workflow will publish once the version-bumped commit lands on `main`.

### Required GitHub secret

Add `NPM_TOKEN` to the repository's Actions secrets (Settings → Secrets → Actions).
The token must be a granular access token scoped to publish `@fragile.app/mcp`.

## Architecture

```
AI Client (Claude Desktop / Copilot / Cursor)
  │  MCP tool call (JSON-RPC over stdio)
  ▼
@fragile.app/mcp  (this package, spawned as a subprocess)
  │  HTTP GET with Authorization: Bearer <API_KEY>
  ▼
Fragile API  (NestJS REST API, port 3001)
  │  TypeORM queries
  ▼
PostgreSQL 16  (data pre-cached by scheduled Jira sync)
```

The MCP server is **read-only for metrics** — metrics tools make only `GET` requests.
Custom report management tools use `GET`, `POST`, `PATCH`, `PUT`, and `DELETE`.
No Jira API calls are made from the MCP server.

## License

MIT
