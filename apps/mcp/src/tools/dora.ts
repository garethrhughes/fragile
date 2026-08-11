import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

/** Rolling time-period window lengths in days (shared with the dashboard). */
const windowSchema = z
  .union([z.literal(7), z.literal(30), z.literal(90)])
  .optional()
  .describe('Rolling time-period window in days: 7, 30, or 90 (last N full days, ending yesterday)');

export function registerDoraTools(server: McpServer): void {
  server.tool(
    'get_dora_metrics',
    'Get aggregated org-level or per-board DORA metrics for a calendar quarter, a sprint, or a rolling time-period window (last 7/30/90 days).',
    {
      boardId: z.string().optional().describe('Comma-separated board IDs, e.g. "ACC,BPT"'),
      quarter: z.string().optional().describe('Target quarter in YYYY-QN format, e.g. "2026-Q2"'),
      sprintId: z.string().optional().describe('Sprint ID — scopes metrics to the sprint window (single board)'),
      window: windowSchema,
    },
    async ({ boardId, quarter, sprintId, window }) => {
      const params: Record<string, string | number | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (quarter) params['quarter'] = quarter;
      if (sprintId) params['sprintId'] = sprintId;
      if (window !== undefined) params['window'] = window;

      const result = await apiGet('/api/metrics/dora/aggregate', params);

      if (result.status === 202) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'DORA snapshot is still being computed. Please try again in a few moments.',
            },
          ],
        };
      }

      const data = result.data as Record<string, unknown> | null | undefined;
      const period = data?.period as { label?: string; partial?: boolean; elapsedDays?: number; totalDays?: number } | undefined;

      const blocks: Array<{ type: 'text'; text: string }> = [];

      // Annotate partial quarters so AI consumers understand the rate is conservative.
      // deploymentsPerDay is always divided by the full period (totalDays), not elapsedDays.
      if (period?.partial === true) {
        blocks.push({
          type: 'text' as const,
          text:
            `Note: ${period.label ?? 'current quarter'} is in progress ` +
            `(${period.elapsedDays}/${period.totalDays} days elapsed). ` +
            `deploymentsPerDay is divided by the full ${period.totalDays}-day period, not elapsed days. ` +
            `For the actual current pace use: totalDeployments / elapsedDays.`,
        });
      }

      blocks.push({
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      });

      return { content: blocks };
    },
  );

  server.tool(
    'get_dora_trend',
    'Get DORA metrics across multiple periods to show trajectory — by quarter (default), by sprint, or as rolling time-period buckets (mode=timeperiod with a window).',
    {
      boardId: z.string().optional().describe('Comma-separated board IDs'),
      mode: z
        .enum(['quarter', 'sprint', 'timeperiod'])
        .optional()
        .describe('Trend mode: "quarter" (default), "sprint", or "timeperiod" (rolling daily/weekly buckets)'),
      limit: z.number().int().positive().optional().default(6).describe('Number of periods to return (default 6)'),
      sprintId: z.string().optional().describe('Sprint ID — only used with mode=sprint'),
      window: windowSchema,
    },
    async ({ boardId, mode, limit, sprintId, window }) => {
      const params: Record<string, string | number | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (mode) params['mode'] = mode;
      if (limit !== undefined) params['limit'] = limit;
      if (sprintId) params['sprintId'] = sprintId;
      if (window !== undefined) params['window'] = window;

      const result = await apiGet('/api/metrics/dora/trend', params);
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
    'get_snapshot_status',
    'Check whether DORA snapshots have been computed for each board.',
    {},
    async () => {
      const result = await apiGet('/api/metrics/dora/snapshot/status');
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
