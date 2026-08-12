import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

/** Rolling time-period window lengths in days (shared with the dashboard). */
const windowSchema = z
  .union([z.literal(7), z.literal(30), z.literal(90)])
  .optional()
  .describe('Rolling time-period window in days: 7, 30, or 90 (last N full days, ending yesterday)');

export function registerSupportTools(server: McpServer): void {
  server.tool(
    'get_support_tickets',
    'Get support ticket observations (cycle time, and each ticket\'s match reason) for one or more boards in a given period — by quarter, sprint, explicit range, or a rolling time-period window (7/30/90 days).',
    {
      boardId: z.string().optional().describe('Board identifier — omit for all boards'),
      quarter: z.string().optional().describe('Quarter in YYYY-QN format'),
      sprintId: z.string().optional().describe('Sprint ID (alternative to quarter)'),
      period: z.string().optional().describe('Explicit date range in YYYY-MM-DD:YYYY-MM-DD format'),
      window: windowSchema,
    },
    async ({ boardId, quarter, sprintId, period, window }) => {
      const params: Record<string, string | number | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (quarter) params['quarter'] = quarter;
      if (sprintId) params['sprintId'] = sprintId;
      if (period) params['period'] = period;
      if (window !== undefined) params['window'] = window;

      const result = await apiGet('/api/support', params);
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

  server.tool(
    'get_support_summary',
    'Get aggregated support metrics (% support load, p50 and p95 cycle time, per-board breakdown) for a period — by quarter, sprint, explicit range, or a rolling time-period window (7/30/90 days).',
    {
      boardId: z.string().optional().describe('Board identifier — omit for all boards'),
      quarter: z.string().optional().describe('Quarter in YYYY-QN format'),
      sprintId: z.string().optional().describe('Sprint ID (alternative to quarter)'),
      period: z.string().optional().describe('Explicit date range in YYYY-MM-DD:YYYY-MM-DD format'),
      window: windowSchema,
    },
    async ({ boardId, quarter, sprintId, period, window }) => {
      const params: Record<string, string | number | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (quarter) params['quarter'] = quarter;
      if (sprintId) params['sprintId'] = sprintId;
      if (period) params['period'] = period;
      if (window !== undefined) params['window'] = window;

      const result = await apiGet('/api/support/summary', params);
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
