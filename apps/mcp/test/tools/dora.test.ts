import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockApiGet, mockSuccess, mockPending } from '../client.mock.js';

// Mock client before importing tools
vi.mock('../../src/client.js', () => ({
  apiGet: mockApiGet,
}));

// Import tool handlers under test
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDoraTools } from '../../src/tools/dora.js';
import { callTool } from '../test-helpers.js';

function makeServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerDoraTools(server);
  return server;
}

describe('DORA tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get_dora_metrics', () => {
    it('returns JSON text content from the API response', async () => {
      const data = { period: { label: '2026-Q1', partial: false, elapsedDays: 91, totalDays: 91 }, deploymentFrequency: { band: 'elite' } };
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_dora_metrics', { quarter: '2026-Q1' });

      expect(result.content[0]?.type).toBe('text');
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/aggregate', { quarter: '2026-Q1' });
    });

    it('passes boardId and quarter as query params', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess({}));
      const server = makeServer();
      await callTool(server, 'get_dora_metrics', { boardId: 'ACC,BPT', quarter: '2026-Q2' });
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/aggregate', {
        boardId: 'ACC,BPT',
        quarter: '2026-Q2',
      });
    });

    it('returns informational text on 202 Pending response', async () => {
      mockApiGet.mockResolvedValueOnce(mockPending({ status: 'pending' }));
      const server = makeServer();
      const result = await callTool(server, 'get_dora_metrics', {});
      expect(result.content[0]?.text).toContain('still being computed');
    });

    it('omits optional params when not provided', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess([]));
      const server = makeServer();
      await callTool(server, 'get_dora_metrics', {});
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/aggregate', {});
    });

    it('passes window for the rolling time-period view', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess({}));
      const server = makeServer();
      await callTool(server, 'get_dora_metrics', { boardId: 'ACC', window: 30 });
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/aggregate', {
        boardId: 'ACC',
        window: 30,
      });
    });

    it('passes sprintId when provided', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess({}));
      const server = makeServer();
      await callTool(server, 'get_dora_metrics', { boardId: 'ACC', sprintId: '123' });
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/aggregate', {
        boardId: 'ACC',
        sprintId: '123',
      });
    });

    it('prepends partial-period annotation when period.partial is true', async () => {
      const data = {
        period: { label: '2026-Q2', partial: true, elapsedDays: 41, totalDays: 91 },
        orgDeploymentFrequency: { deploymentsPerDay: 0.04, totalDeployments: 4, periodDays: 91 },
      };
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_dora_metrics', { quarter: '2026-Q2' });

      // Should have 2 content blocks: annotation + JSON
      expect(result.content).toHaveLength(2);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('2026-Q2');
      expect(result.content[0]?.text).toContain('41');
      expect(result.content[0]?.text).toContain('91');
      // The annotation should explain the denominator semantics
      expect(result.content[0]?.text).toContain('deploymentsPerDay');
      // Second block is the raw JSON
      expect(result.content[1]?.type).toBe('text');
      expect(JSON.parse(result.content[1]?.text ?? '')).toEqual(data);
    });

    it('does NOT prepend annotation when period.partial is false', async () => {
      const data = {
        period: { label: '2025-Q4', partial: false, elapsedDays: 92, totalDays: 92 },
        orgDeploymentFrequency: { deploymentsPerDay: 0.1, totalDeployments: 9, periodDays: 92 },
      };
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_dora_metrics', { quarter: '2025-Q4' });

      // Only the JSON block — no annotation
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
    });

    it('does NOT prepend annotation when period metadata is absent (legacy response)', async () => {
      const data = { orgDeploymentFrequency: { deploymentsPerDay: 0.05 } };
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_dora_metrics', {});

      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
    });
  });

  describe('get_dora_trend', () => {
    it('returns trend data as JSON text', async () => {
      const data = [{ period: '2026-Q1' }, { period: '2025-Q4' }];
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_dora_trend', { limit: 6 });

      expect(result.content[0]?.type).toBe('text');
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/trend', { limit: 6 });
    });

    it('passes boardId when provided', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess([]));
      const server = makeServer();
      await callTool(server, 'get_dora_trend', { boardId: 'ACC', limit: 4 });
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/trend', { boardId: 'ACC', limit: 4 });
    });

    it('passes mode=timeperiod with a window', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess([]));
      const server = makeServer();
      await callTool(server, 'get_dora_trend', { boardId: 'ACC', mode: 'timeperiod', window: 90 });
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/trend', {
        boardId: 'ACC',
        mode: 'timeperiod',
        limit: 6,
        window: 90,
      });
    });

    it('passes mode=sprint with a sprintId', async () => {
      mockApiGet.mockResolvedValueOnce(mockSuccess([]));
      const server = makeServer();
      await callTool(server, 'get_dora_trend', { boardId: 'ACC', mode: 'sprint', sprintId: '77' });
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/trend', {
        boardId: 'ACC',
        mode: 'sprint',
        limit: 6,
        sprintId: '77',
      });
    });
  });

  describe('get_snapshot_status', () => {
    it('returns snapshot status as JSON text', async () => {
      const data = [{ boardId: 'ACC', stale: false }];
      mockApiGet.mockResolvedValueOnce(mockSuccess(data));

      const server = makeServer();
      const result = await callTool(server, 'get_snapshot_status', {});

      expect(result.content[0]?.type).toBe('text');
      expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
      expect(mockApiGet).toHaveBeenCalledWith('/api/metrics/dora/snapshot/status');
    });
  });
});
