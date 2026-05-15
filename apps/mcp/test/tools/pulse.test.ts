import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockApiGet, mockSuccess } from '../client.mock.js';

vi.mock('../../src/client.js', () => ({
  apiGet: mockApiGet,
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerPulseTools } from '../../src/tools/pulse.js';
import { callTool } from '../test-helpers.js';

function makeServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerPulseTools(server);
  return server;
}

describe('Pulse tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get_pulse_report', () => {
    it('returns pulse data for a given week', async () => {
      const data = {
        week: '2026-W20',
        boards: [{ boardId: 'ACC', boardType: 'scrum', items: [], summary: {} }],
        totals: { totalItems: 28 },
        overallScore: 91,
      };
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_pulse_report', { week: '2026-W20' });

      expect(result.content[0]?.type).toBe('text');
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
      expect(mockApiGet).toHaveBeenCalledWith('/api/all-items', { week: '2026-W20' });
    });

    it('passes filter parameter when provided', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess({ week: '2026-W20', boards: [] }));

      const server = makeServer();
      await callTool(server, 'get_pulse_report', { week: '2026-W20', filter: 'support' });

      expect(mockApiGet).toHaveBeenCalledWith('/api/all-items', { week: '2026-W20', filter: 'support' });
    });

    it('omits filter parameter when not provided', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess({ week: '2026-W19', boards: [] }));

      const server = makeServer();
      await callTool(server, 'get_pulse_report', { week: '2026-W19' });

      expect(mockApiGet).toHaveBeenCalledWith('/api/all-items', { week: '2026-W19' });
    });
  });
});
