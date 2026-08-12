import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

/** Rolling time-period window lengths in days (shared with the dashboard). */
const windowSchema = z
  .union([z.literal(7), z.literal(30), z.literal(90)])
  .optional()
  .describe('Rolling time-period window in days: 7, 30, or 90 (last N full days, ending yesterday)');

export function registerCycleTimeTools(server: McpServer): void {
  server.tool(
    'get_cycle_time',
    'Get cycle time observations and percentiles (median, p95) for a board and period — by quarter, sprint, explicit range, or a rolling time-period window (7/30/90 days).',
    {
      boardId: z.string().describe('Board identifier'),
      quarter: z.string().optional().describe('Quarter in YYYY-QN format'),
      sprintId: z.string().optional().describe('Sprint ID (alternative to quarter)'),
      period: z.string().optional().describe('Explicit date range in YYYY-MM-DD:YYYY-MM-DD format'),
      window: windowSchema,
    },
    async ({ boardId, quarter, sprintId, period, window }) => {
      const params: Record<string, string | number | undefined> = {};
      if (quarter) params['quarter'] = quarter;
      if (sprintId) params['sprintId'] = sprintId;
      if (period) params['period'] = period;
      if (window !== undefined) params['window'] = window;

      const result = await apiGet(`/api/cycle-time/${encodeURIComponent(boardId)}`, params);
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
    'get_cycle_time_trend',
    'Get cycle time trend across multiple periods — by quarter (default), by sprint, or as rolling time-period buckets (mode=timeperiod with a window).',
    {
      boardId: z.string().optional().describe('Board identifier'),
      mode: z
        .enum(['quarters', 'sprints', 'timeperiod'])
        .optional()
        .describe('Aggregation mode: "quarters" (default), "sprints", or "timeperiod" (rolling daily/weekly buckets)'),
      limit: z.number().int().positive().optional().describe('Number of periods to return'),
      window: windowSchema,
    },
    async ({ boardId, mode, limit, window }) => {
      const params: Record<string, string | number | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (mode) params['mode'] = mode;
      if (limit !== undefined) params['limit'] = limit;
      if (window !== undefined) params['window'] = window;

      const result = await apiGet('/api/cycle-time/trend', params);
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
