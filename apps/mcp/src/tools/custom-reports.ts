import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '../client.js';

const dataPointSchema = z.object({
  x: z.string().describe('X-axis value (ISO date string or bucket label)'),
  y: z.number(),
  series: z.string().optional(),
  dimensions: z.record(z.string()).optional().describe('Key-value pairs for client-side filtering'),
});

function json(data: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerCustomReportsTools(server: McpServer): void {
  // ── Reports ──────────────────────────────────────────────────────────────

  server.tool(
    'list_custom_reports',
    'List all custom reports (id, slug, title, timestamps — no nested data).',
    {},
    async () => {
      const result = await apiGet('/api/custom-reports');
      return json(result.data);
    },
  );

  server.tool(
    'get_custom_report',
    'Get a custom report by slug, including all graphs, data points, and filter definitions.',
    { slug: z.string().describe('URL-safe report slug') },
    async ({ slug }) => {
      const result = await apiGet(`/api/custom-reports/${encodeURIComponent(slug)}`);
      return json(result.data);
    },
  );

  server.tool(
    'create_custom_report',
    'Create a new custom report. The slug must be unique, lowercase, and contain only letters, digits, and hyphens.',
    {
      slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
      title: z.string().max(200),
      description: z.string().max(4000).optional(),
      layout: z.record(z.unknown()).optional(),
    },
    async (body) => {
      const result = await apiPost('/api/custom-reports', body);
      return json(result.data);
    },
  );

  server.tool(
    'update_custom_report',
    'Update the title, description, or layout of an existing custom report.',
    {
      slug: z.string(),
      title: z.string().max(200).optional(),
      description: z.string().max(4000).optional(),
      layout: z.record(z.unknown()).optional(),
    },
    async ({ slug, ...body }) => {
      const result = await apiPatch(`/api/custom-reports/${encodeURIComponent(slug)}`, body);
      return json(result.data);
    },
  );

  server.tool(
    'delete_custom_report',
    'Delete a custom report and all its graphs, data points, and filters.',
    { slug: z.string() },
    async ({ slug }) => {
      await apiDelete(`/api/custom-reports/${encodeURIComponent(slug)}`);
      return json({ deleted: true });
    },
  );

  // ── Graphs ───────────────────────────────────────────────────────────────

  server.tool(
    'add_custom_report_graph',
    'Add a graph (chart) to a custom report. kind must be one of: line, bar, area.',
    {
      slug: z.string(),
      kind: z.enum(['line', 'bar', 'area']),
      title: z.string().max(200),
      seriesKey: z.string().max(100).optional().describe('Dimension key used to split into separate series'),
      xAxisLabel: z.string().max(100).optional(),
      yAxisLabel: z.string().max(100).optional(),
      position: z.number().int().min(0).optional(),
    },
    async ({ slug, ...body }) => {
      const result = await apiPost(
        `/api/custom-reports/${encodeURIComponent(slug)}/graphs`,
        body,
      );
      return json(result.data);
    },
  );

  server.tool(
    'update_custom_report_graph',
    'Update an existing graph on a custom report.',
    {
      slug: z.string(),
      graphId: z.string().uuid(),
      kind: z.enum(['line', 'bar', 'area']).optional(),
      title: z.string().max(200).optional(),
      seriesKey: z.string().max(100).optional(),
      xAxisLabel: z.string().max(100).optional(),
      yAxisLabel: z.string().max(100).optional(),
      position: z.number().int().min(0).optional(),
    },
    async ({ slug, graphId, ...body }) => {
      const result = await apiPatch(
        `/api/custom-reports/${encodeURIComponent(slug)}/graphs/${encodeURIComponent(graphId)}`,
        body,
      );
      return json(result.data);
    },
  );

  server.tool(
    'delete_custom_report_graph',
    'Delete a graph and all its data points from a custom report.',
    { slug: z.string(), graphId: z.string().uuid() },
    async ({ slug, graphId }) => {
      await apiDelete(
        `/api/custom-reports/${encodeURIComponent(slug)}/graphs/${encodeURIComponent(graphId)}`,
      );
      return json({ deleted: true });
    },
  );

  // ── Data points ──────────────────────────────────────────────────────────

  server.tool(
    'append_custom_report_data',
    'Append data points to a graph. Existing points are preserved (additive). Max 1000 points per call.',
    {
      slug: z.string(),
      graphId: z.string().uuid(),
      points: z.array(dataPointSchema).min(1).max(1000),
    },
    async ({ slug, graphId, points }) => {
      const result = await apiPost(
        `/api/custom-reports/${encodeURIComponent(slug)}/graphs/${encodeURIComponent(graphId)}/data-points`,
        { points },
      );
      return json(result.data);
    },
  );

  server.tool(
    'replace_custom_report_data',
    'Replace all data points for a graph with the provided set. Existing points are deleted first. Max 1000 points per call.',
    {
      slug: z.string(),
      graphId: z.string().uuid(),
      points: z.array(dataPointSchema).min(1).max(1000),
    },
    async ({ slug, graphId, points }) => {
      const result = await apiPut(
        `/api/custom-reports/${encodeURIComponent(slug)}/graphs/${encodeURIComponent(graphId)}/data-points`,
        { points },
      );
      return json(result.data);
    },
  );

  server.tool(
    'clear_custom_report_data',
    'Delete all data points for a graph without removing the graph itself.',
    { slug: z.string(), graphId: z.string().uuid() },
    async ({ slug, graphId }) => {
      await apiDelete(
        `/api/custom-reports/${encodeURIComponent(slug)}/graphs/${encodeURIComponent(graphId)}/data-points`,
      );
      return json({ cleared: true });
    },
  );

  // ── Filters ──────────────────────────────────────────────────────────────

  server.tool(
    'add_custom_report_filter',
    'Add a filter definition to a report. The key should match a field in the data-point dimensions map.',
    {
      slug: z.string(),
      key: z.string().max(200).describe('Dimension key to filter on'),
      label: z.string().max(200).describe('Display label shown in the UI'),
      kind: z.enum(['select', 'multiselect']),
      defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
      position: z.number().int().min(0).optional(),
    },
    async ({ slug, ...body }) => {
      const result = await apiPost(
        `/api/custom-reports/${encodeURIComponent(slug)}/filters`,
        body,
      );
      return json(result.data);
    },
  );

  server.tool(
    'delete_custom_report_filter',
    'Remove a filter definition from a report.',
    { slug: z.string(), filterId: z.string().uuid() },
    async ({ slug, filterId }) => {
      await apiDelete(
        `/api/custom-reports/${encodeURIComponent(slug)}/filters/${encodeURIComponent(filterId)}`,
      );
      return json({ deleted: true });
    },
  );
}
