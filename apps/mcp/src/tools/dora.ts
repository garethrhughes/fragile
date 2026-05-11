import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

export function registerDoraTools(server: McpServer): void {
  server.tool(
    'get_dora_metrics',
    'Get aggregated org-level or per-board DORA metrics for a calendar quarter.',
    {
      boardId: z.string().optional().describe('Comma-separated board IDs, e.g. "ACC,BPT"'),
      quarter: z.string().optional().describe('Target quarter in YYYY-QN format, e.g. "2026-Q2"'),
    },
    async ({ boardId, quarter }) => {
      const params: Record<string, string | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (quarter) params['quarter'] = quarter;

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
    'Get DORA metrics across multiple consecutive quarters to show trajectory.',
    {
      boardId: z.string().optional().describe('Comma-separated board IDs'),
      limit: z.number().int().positive().optional().default(6).describe('Number of quarters to return (default 6)'),
    },
    async ({ boardId, limit }) => {
      const params: Record<string, string | number | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (limit !== undefined) params['limit'] = limit;

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
