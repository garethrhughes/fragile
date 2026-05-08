/**
 * Tests for custom-reports MCP tools (AC9).
 *
 * Verifies that all 13 custom-report tools are registered on the MCP server
 * and that each tool delegates correctly to the corresponding HTTP endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mockApiGet,
  mockApiPost,
  mockApiPatch,
  mockApiPut,
  mockApiDelete,
  mockSuccess,
} from '../client.mock.js';

vi.mock('../../src/client.js', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPatch: mockApiPatch,
  apiPut: mockApiPut,
  apiDelete: mockApiDelete,
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCustomReportsTools } from '../../src/tools/custom-reports.js';
import { callTool } from '../test-helpers.js';

// A valid UUID to satisfy z.string().uuid() schema constraints in the tools
const GRAPH_UUID = '00000000-0000-4000-a000-000000000001';
const FILTER_UUID = '00000000-0000-4000-a000-000000000002';

function makeServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCustomReportsTools(server);
  return server;
}

const EXPECTED_TOOLS = [
  'list_custom_reports',
  'get_custom_report',
  'create_custom_report',
  'update_custom_report',
  'delete_custom_report',
  'add_custom_report_graph',
  'update_custom_report_graph',
  'delete_custom_report_graph',
  'append_custom_report_data',
  'replace_custom_report_data',
  'clear_custom_report_data',
  'add_custom_report_filter',
  'delete_custom_report_filter',
] as const;

describe('custom-reports MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers exactly 13 tools (AC9)', () => {
    const server = makeServer();
    expect(EXPECTED_TOOLS).toHaveLength(13);
    expect(server).toBeDefined();
  });

  it('list_custom_reports — calls GET /api/custom-reports', async () => {
    const data = [{ id: '1', slug: 'demo', title: 'Demo' }];
    mockApiGet.mockResolvedValueOnce(mockSuccess(data));
    const server = makeServer();
    const result = await callTool(server, 'list_custom_reports', {});
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(data);
    expect(mockApiGet).toHaveBeenCalledWith('/api/custom-reports');
  });

  it('get_custom_report — calls GET /api/custom-reports/:slug', async () => {
    const report = { id: '1', slug: 'demo', title: 'Demo', graphs: [], filters: [] };
    mockApiGet.mockResolvedValueOnce(mockSuccess(report));
    const server = makeServer();
    const result = await callTool(server, 'get_custom_report', { slug: 'demo' });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(report);
    expect(mockApiGet).toHaveBeenCalledWith('/api/custom-reports/demo');
  });

  it('create_custom_report — calls POST /api/custom-reports', async () => {
    const created = { id: '1', slug: 'my-report', title: 'My Report' };
    mockApiPost.mockResolvedValueOnce(mockSuccess(created, 201));
    const server = makeServer();
    const result = await callTool(server, 'create_custom_report', {
      slug: 'my-report',
      title: 'My Report',
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(created);
    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/custom-reports',
      expect.objectContaining({ slug: 'my-report', title: 'My Report' }),
    );
  });

  it('update_custom_report — calls PATCH /api/custom-reports/:slug', async () => {
    const updated = { id: '1', slug: 'demo', title: 'New Title' };
    mockApiPatch.mockResolvedValueOnce(mockSuccess(updated));
    const server = makeServer();
    const result = await callTool(server, 'update_custom_report', {
      slug: 'demo',
      title: 'New Title',
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(updated);
    expect(mockApiPatch).toHaveBeenCalledWith(
      '/api/custom-reports/demo',
      expect.objectContaining({ title: 'New Title' }),
    );
  });

  it('delete_custom_report — calls DELETE /api/custom-reports/:slug', async () => {
    mockApiDelete.mockResolvedValueOnce(mockSuccess(undefined, 204));
    const server = makeServer();
    const result = await callTool(server, 'delete_custom_report', { slug: 'demo' });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ deleted: true });
    expect(mockApiDelete).toHaveBeenCalledWith('/api/custom-reports/demo');
  });

  it('add_custom_report_graph — calls POST /api/custom-reports/:slug/graphs', async () => {
    const graph = { id: GRAPH_UUID, kind: 'line', title: 'Chart' };
    mockApiPost.mockResolvedValueOnce(mockSuccess(graph, 201));
    const server = makeServer();
    const result = await callTool(server, 'add_custom_report_graph', {
      slug: 'demo',
      kind: 'line',
      title: 'Chart',
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(graph);
    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/custom-reports/demo/graphs',
      expect.objectContaining({ kind: 'line', title: 'Chart' }),
    );
  });

  it('update_custom_report_graph — calls PATCH /api/custom-reports/:slug/graphs/:graphId', async () => {
    const graph = { id: GRAPH_UUID, kind: 'bar', title: 'Updated Chart' };
    mockApiPatch.mockResolvedValueOnce(mockSuccess(graph));
    const server = makeServer();
    const result = await callTool(server, 'update_custom_report_graph', {
      slug: 'demo',
      graphId: GRAPH_UUID,
      title: 'Updated Chart',
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(graph);
    expect(mockApiPatch).toHaveBeenCalledWith(
      `/api/custom-reports/demo/graphs/${GRAPH_UUID}`,
      expect.objectContaining({ title: 'Updated Chart' }),
    );
  });

  it('delete_custom_report_graph — calls DELETE /api/custom-reports/:slug/graphs/:graphId', async () => {
    mockApiDelete.mockResolvedValueOnce(mockSuccess(undefined, 204));
    const server = makeServer();
    const result = await callTool(server, 'delete_custom_report_graph', {
      slug: 'demo',
      graphId: GRAPH_UUID,
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ deleted: true });
    expect(mockApiDelete).toHaveBeenCalledWith(
      `/api/custom-reports/demo/graphs/${GRAPH_UUID}`,
    );
  });

  it('append_custom_report_data — calls POST .../data-points', async () => {
    const res = { appended: 1 };
    mockApiPost.mockResolvedValueOnce(mockSuccess(res, 201));
    const server = makeServer();
    const result = await callTool(server, 'append_custom_report_data', {
      slug: 'demo',
      graphId: GRAPH_UUID,
      points: [{ x: '2024-01', y: 10 }],
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(res);
    expect(mockApiPost).toHaveBeenCalledWith(
      `/api/custom-reports/demo/graphs/${GRAPH_UUID}/data-points`,
      expect.objectContaining({ points: [{ x: '2024-01', y: 10 }] }),
    );
  });

  it('replace_custom_report_data — calls PUT .../data-points', async () => {
    const res = { replaced: 1 };
    mockApiPut.mockResolvedValueOnce(mockSuccess(res));
    const server = makeServer();
    const result = await callTool(server, 'replace_custom_report_data', {
      slug: 'demo',
      graphId: GRAPH_UUID,
      points: [{ x: '2024-01', y: 99 }],
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(res);
    expect(mockApiPut).toHaveBeenCalledWith(
      `/api/custom-reports/demo/graphs/${GRAPH_UUID}/data-points`,
      expect.objectContaining({ points: [{ x: '2024-01', y: 99 }] }),
    );
  });

  it('clear_custom_report_data — calls DELETE .../data-points', async () => {
    mockApiDelete.mockResolvedValueOnce(mockSuccess(undefined, 204));
    const server = makeServer();
    const result = await callTool(server, 'clear_custom_report_data', {
      slug: 'demo',
      graphId: GRAPH_UUID,
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ cleared: true });
    expect(mockApiDelete).toHaveBeenCalledWith(
      `/api/custom-reports/demo/graphs/${GRAPH_UUID}/data-points`,
    );
  });

  it('add_custom_report_filter — calls POST .../filters', async () => {
    const filter = { id: FILTER_UUID, key: 'team', label: 'Team', kind: 'select' };
    mockApiPost.mockResolvedValueOnce(mockSuccess(filter, 201));
    const server = makeServer();
    const result = await callTool(server, 'add_custom_report_filter', {
      slug: 'demo',
      key: 'team',
      label: 'Team',
      kind: 'select',
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual(filter);
    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/custom-reports/demo/filters',
      expect.objectContaining({ key: 'team', label: 'Team', kind: 'select' }),
    );
  });

  it('delete_custom_report_filter — calls DELETE .../filters/:filterId', async () => {
    mockApiDelete.mockResolvedValueOnce(mockSuccess(undefined, 204));
    const server = makeServer();
    const result = await callTool(server, 'delete_custom_report_filter', {
      slug: 'demo',
      filterId: FILTER_UUID,
    });
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ deleted: true });
    expect(mockApiDelete).toHaveBeenCalledWith(
      `/api/custom-reports/demo/filters/${FILTER_UUID}`,
    );
  });
});
