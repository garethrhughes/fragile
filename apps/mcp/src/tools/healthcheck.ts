import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

export function registerHealthcheckTools(server: McpServer): void {
  server.tool(
    'get_healthcheck_report',
    'Get the weekly engineering healthcheck. For a selected ISO week, returns three per-board scores computed against a single shared denominator — the tickets whose first-ever start transition fell in that week: Stability (% of started tickets that were planned/committed or carried over at their sprint start; scrum only), Roadmap (% of started tickets that are roadmap-linked; scrum only), and Support (% of started tickets classified as reactive support; all boards, where lower is better). Stability and Roadmap are N/A for kanban boards. Each board also carries an 8-week trend of the three scores (oldest→newest), with N/A weeks as null. Defaults to the last completed week when "week" is omitted.',
    {
      week: z
        .string()
        .optional()
        .describe('ISO week key in YYYY-Www format, e.g. "2026-W30". Defaults to the last completed week.'),
    },
    async ({ week }) => {
      const params: Record<string, string | undefined> = {};
      if (week) params['week'] = week;

      const result = await apiGet('/api/healthcheck', params);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      };
    },
  );
}
