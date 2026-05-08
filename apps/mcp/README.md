# @fragile.app/mcp

MCP (Model Context Protocol) server for the
[Fragile dashboard](https://github.com/garethrhughes/fragile). It exposes 31 tools,
2 resources, and 5 prompt templates over stdio.

## Quick start

```bash
npx -y @fragile.app/mcp
```

Required environment:

| Variable | Required | Description |
|---|---|---|
| `API_BASE_URL` | **Yes** | Base URL for the Fragile API (for example `https://fragile.example.com`) |
| `API_KEY` | No | Optional bearer token sent as `Authorization: Bearer <API_KEY>` |

## Claude Desktop setup

```json
{
  "mcpServers": {
    "fragile": {
      "command": "npx",
      "args": ["-y", "@fragile.app/mcp"],
      "env": {
        "API_BASE_URL": "https://fragile.example.com",
        "API_KEY": "optional-token"
      }
    }
  }
}
```

## Cursor setup

```json
{
  "mcpServers": {
    "fragile": {
      "command": "npx",
      "args": ["-y", "@fragile.app/mcp"],
      "env": {
        "API_BASE_URL": "https://fragile.example.com"
      }
    }
  }
}
```

## Tools

### Read and analysis tools

- `get_dora_metrics`
- `get_dora_trend`
- `get_snapshot_status`
- `get_planning_accuracy`
- `list_sprints`
- `list_quarters`
- `get_cycle_time`
- `get_cycle_time_trend`
- `get_roadmap_accuracy`
- `list_boards`
- `get_board_config`
- `get_sync_status`
- `get_sprint_detail`
- `get_sprint_report`
- `get_hygiene_gaps`
- `get_unplanned_done`
- `get_support_tickets`
- `get_support_summary`
- `list_custom_reports`
- `get_custom_report`

### Custom report management tools

- `create_custom_report`
- `update_custom_report`
- `delete_custom_report`
- `add_custom_report_widget`
- `update_custom_report_widget`
- `delete_custom_report_widget`
- `append_custom_report_data`
- `replace_custom_report_data`
- `clear_custom_report_data`
- `add_custom_report_filter`
- `delete_custom_report_filter`

## Resources

- `boards://list`
- `boards://{boardId}/config`

## Prompt templates

- `dora_health_report`
- `sprint_retrospective`
- `release_readiness`
- `quarterly_planning_review`
- `support_health_report`

## Local development

```bash
cd apps/mcp
npm install
npm run typecheck
npm run build
npm test
```

## Publishing

Publishing is automated by `.github/workflows/publish-mcp.yml` on pushes to `main` that
touch `apps/mcp/**`.

The workflow:
1. installs dependencies
2. builds the package
3. checks whether the exact version already exists on npm
4. publishes only if that version is new

To release, bump `apps/mcp/package.json` (patch/minor/major) and merge to `main`.

The workflow uses npm trusted publishing (OIDC) and requires repository-to-npm trusted
publisher configuration (no `NPM_TOKEN` secret).

## Notes

- MCP calls are proxied to the Fragile API.
- The server does not call Jira directly.
