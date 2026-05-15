import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

export function registerPulseTools(server: McpServer): void {
  server.tool(
    'get_pulse_report',
    'Get the weekly cross-board pulse report — per-board item counts (total/pulled-in, started, added, completed, on-roadmap, support, in-flight), health scores (roadmap alignment, stability, overall), and optionally filtered issue lists. Covers both scrum and kanban boards.',
    {
      week: z.string().describe('ISO week key in YYYY-Www format, e.g. "2026-W20"'),
      filter: z
        .string()
        .optional()
        .describe('Pipe-separated filter list. Options: "added-mid-sprint", "not-on-roadmap", "support", "ttb-support"'),
    },
    async ({ week, filter }) => {
      const params: Record<string, string | undefined> = { week };
      if (filter) params['filter'] = filter;

      const result = await apiGet('/api/all-items', params);
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
