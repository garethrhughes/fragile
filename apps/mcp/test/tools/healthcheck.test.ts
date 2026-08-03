import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockApiGet, mockSuccess } from '../client.mock.js';

vi.mock('../../src/client.js', () => ({
  apiGet: mockApiGet,
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerHealthcheckTools } from '../../src/tools/healthcheck.js';
import { callTool } from '../test-helpers.js';

function makeServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerHealthcheckTools(server);
  return server;
}

describe('Healthcheck tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get_healthcheck_report', () => {
    it('returns healthcheck data for a given week', async () => {
      const data = {
        week: '2026-W30',
        weekStart: '2026-07-20T00:00:00.000Z',
        weekEnd: '2026-07-26T23:59:59.999Z',
        stability: { score: 75, numerator: 3, denominator: 4, band: 'amber' },
        roadmap: { score: 50, numerator: 2, denominator: 4, band: 'red' },
        support: { score: 25, numerator: 1, denominator: 4, band: 'amber' },
        trend: [],
      };
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_healthcheck_report', { week: '2026-W30' });

      expect(result.content[0]?.type).toBe('text');
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
      expect(mockApiGet).toHaveBeenCalledWith('/api/healthcheck', { week: '2026-W30' });
    });

    it('omits the week parameter when not provided (defaults to last completed week)', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess({ week: '2026-W29', stability: {}, roadmap: {}, support: {}, trend: [] }));

      const server = makeServer();
      await callTool(server, 'get_healthcheck_report', {});

      expect(mockApiGet).toHaveBeenCalledWith('/api/healthcheck', {});
    });
  });
});
