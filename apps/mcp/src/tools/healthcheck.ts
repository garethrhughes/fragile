import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet } from '../client.js';

export function registerHealthcheckTools(server: McpServer): void {
  server.tool(
    'get_healthcheck_report',
    'Get the weekly org-wide engineering healthcheck. For a selected ISO week, returns three pooled scores combining all boards — computed against a per-dimension denominator of the tickets whose first-ever start transition fell in that week: Stability (% of started tickets that were planned/committed or carried over at their sprint start; scrum boards only), Roadmap (% of started tickets that are roadmap-linked; scrum boards only), and Support (% of started tickets classified as reactive support; all boards, where lower is better). Each score pools numerators and denominators across the contributing boards (score = 100 * Σnumerator / Σdenominator). The response also carries an 8-week org trend of the three scores (oldest→newest, N/A weeks as null) and a "tickets" array listing every ticket in the selected week\'s denominator with per-dimension flags (planned, onRoadmap, support) and the derived "firstStart" timestamp that placed it in the week. Defaults to the last completed week when "week" is omitted. Set "includeSupport" to false to exclude support tickets from the Stability and Roadmap scores (the Support score is unaffected) — note this changes both the denominator and the numerators, so figures taken with and without it are not comparable; the response echoes "includeSupport" so you can tell which view you have. A completed week is served from a stored figure by default, so repeated calls return an identical result; the response carries "source" ("stored" or "live"), "computedAt", and "configHash" (a fingerprint of the board status configuration the figure was derived under). Set "view" to "live" to force a recompute from current data — the response then also carries a "drift" object comparing the live figure against the stored one, including tickets that joined or left the week and any ticket whose derived first-start moved later (which is always a defect, since first-start is a minimum over an append-only history).',
    {
      week: z
        .string()
        .optional()
        .describe('ISO week key in YYYY-Www format, e.g. "2026-W30". Defaults to the last completed week.'),
      includeSupport: z
        .boolean()
        .optional()
        .describe(
          'When false, support tickets are excluded from the Stability and Roadmap scores (denominator and numerators); the Support score is unaffected. Defaults to true. Always computed live — never served from or written to the stored figure.',
        ),
      view: z
        .enum(['stored', 'live'])
        .optional()
        .describe(
          'Which figure to return. "stored" (default) serves the persisted canonical figure for a completed week, so a closed week is reproducible. "live" recomputes from current data and returns a "drift" comparison against the stored figure. The current in-flight week is always computed live.',
        ),
    },
    async ({ week, includeSupport, view }) => {
      const params: Record<string, string | undefined> = {};
      if (week) params['week'] = week;
      // Only forward when explicitly disabling — the backend defaults to true.
      if (includeSupport === false) params['includeSupport'] = 'false';
      // Only forward when forcing a recompute — the backend defaults to stored.
      if (view === 'live') params['view'] = 'live';

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
