import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

export function registerHealthcheckTools(server: McpServer): void {
  server.tool(
    'get_healthcheck_report',
    'Get the weekly org-wide engineering healthcheck. For a selected ISO week, returns three pooled scores combining all boards — computed against a per-dimension denominator of the tickets whose first-ever start transition fell in that week: Stability (% of started tickets that were planned/committed or carried over at their sprint start; scrum boards only), Roadmap (% of started tickets that are roadmap-linked; scrum boards only), and Support (% of started tickets classified as reactive support; all boards, where lower is better). Each score pools numerators and denominators across the contributing boards (score = 100 * Σnumerator / Σdenominator). The response also carries an 8-week org trend of the three scores (oldest→newest), with N/A weeks as null. Defaults to the last completed week when "week" is omitted.',
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
