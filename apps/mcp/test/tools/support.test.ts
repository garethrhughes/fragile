import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockApiGet, mockSuccess } from '../client.mock.js';

vi.mock('../../src/client.js', () => ({
  apiGet: mockApiGet,
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSupportTools } from '../../src/tools/support.js';
import { callTool } from '../test-helpers.js';

function makeServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerSupportTools(server);
  return server;
}

describe('Support tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get_support_tickets', () => {
    it('returns support ticket results for all boards', async () => {
      const data = [{ boardId: 'ACC', supportIssues: 5, totalIssues: 40, tickets: [] }];
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_support_tickets', { quarter: '2026-Q1' });

      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
      expect(mockApiGet).toHaveBeenCalledWith('/api/support', { quarter: '2026-Q1' });
    });

    it('passes boardId filter when provided', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess([]));
      const server = makeServer();
      await callTool(server, 'get_support_tickets', { boardId: 'BPT', quarter: '2026-Q1' });
      expect(mockApiGet).toHaveBeenCalledWith('/api/support', { boardId: 'BPT', quarter: '2026-Q1' });
    });

    it('omits optional params when not provided', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess([]));
      const server = makeServer();
      await callTool(server, 'get_support_tickets', {});
      expect(mockApiGet).toHaveBeenCalledWith('/api/support', {});
    });
  });

  describe('get_support_summary', () => {
    it('returns support summary data', async () => {
      const data = {
        totalIssues: 100,
        supportIssues: 12,
        supportPercentage: 12,
        p50Days: 3.5,
        p95Days: 14,
        byBoard: [],
      };
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_support_summary', { quarter: '2026-Q1' });

      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
      expect(mockApiGet).toHaveBeenCalledWith('/api/support/summary', { quarter: '2026-Q1' });
    });

    it('passes boardId filter to summary endpoint', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess({}));
      const server = makeServer();
      await callTool(server, 'get_support_summary', { boardId: 'ACC', quarter: '2026-Q2' });
      expect(mockApiGet).toHaveBeenCalledWith('/api/support/summary', {
        boardId: 'ACC',
        quarter: '2026-Q2',
      });
    });
  });
});
