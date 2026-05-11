import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

export function registerSupportTools(server: McpServer): void {
  server.tool(
    'get_support_tickets',
    'Get support ticket observations (cycle time, match reason) for one or more boards in a given period.',
    {
      boardId: z.string().optional().describe('Board identifier — omit for all boards'),
      quarter: z.string().optional().describe('Quarter in YYYY-QN format'),
      sprintId: z.string().optional().describe('Sprint ID (alternative to quarter)'),
      period: z.string().optional().describe('ISO date range in YYYY-MM-DD/YYYY-MM-DD format'),
      matchReason: z
        .enum(['link', 'label', 'epic'])
        .optional()
        .describe(
          'Filter tickets by match reason. Use "link" to return only issues linked to the triage board (TTB). ' +
          'totalIssues denominator is unaffected.',
        ),
    },
    async ({ boardId, quarter, sprintId, period, matchReason }) => {
      const params: Record<string, string | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (quarter) params['quarter'] = quarter;
      if (sprintId) params['sprintId'] = sprintId;
      if (period) params['period'] = period;
      if (matchReason) params['matchReason'] = matchReason;

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
    'Get aggregated support metrics (% support load, p50 and p95 cycle time, per-board breakdown) for a period.',
    {
      boardId: z.string().optional().describe('Board identifier — omit for all boards'),
      quarter: z.string().optional().describe('Quarter in YYYY-QN format'),
      sprintId: z.string().optional().describe('Sprint ID (alternative to quarter)'),
      period: z.string().optional().describe('ISO date range in YYYY-MM-DD/YYYY-MM-DD format'),
      matchReason: z
        .enum(['link', 'label', 'epic'])
        .optional()
        .describe(
          'Filter summary stats by match reason. Use "link" to return stats for only triage-board-linked issues. ' +
          'totalIssues denominator is unaffected.',
        ),
    },
    async ({ boardId, quarter, sprintId, period, matchReason }) => {
      const params: Record<string, string | undefined> = {};
      if (boardId) params['boardId'] = boardId;
      if (quarter) params['quarter'] = quarter;
      if (sprintId) params['sprintId'] = sprintId;
      if (period) params['period'] = period;
      if (matchReason) params['matchReason'] = matchReason;

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
