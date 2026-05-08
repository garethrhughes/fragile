/**
 * Tests for CustomReportView component.
 *
 * Strategy:
 *  - Recharts renders SVG — jsdom renders it but chart-specific internals are not
 *    testable without canvas mocks. We assert the container element and title text.
 *  - CustomReportView is tested with mock report data; applyFilters is already
 *    unit-tested in custom-report-filtering.test.ts.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { CustomReport, CustomReportWidget as CustomReportWidgetType } from '@/lib/api'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  listCustomReports: vi.fn(),
  getCustomReport: vi.fn(),
}))

// Recharts uses ResizeObserver which is not available in jsdom
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

import { CustomReportView } from './CustomReportView'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeReport = (overrides?: Partial<CustomReport>): CustomReport => ({
  id: 'r1',
  slug: 'demo',
  title: 'Demo Report',
  description: null,
  layout: null,
  widgets: [],
  filters: [],
  jiraBaseUrl: 'https://example.atlassian.net',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeWidget = (kind: 'line' | 'bar' | 'area' = 'line'): CustomReportWidgetType => ({
  id: 'w1',
  customReportId: 'r1',
  kind,
  title: `${kind} chart`,
  position: 0,
  seriesKey: null,
  xAxisLabel: null,
  yAxisLabel: null,
  columns: null,
  statUnit: null,
  statSubtitle: null,
  statBand: null,
  createdAt: '2024-01-01T00:00:00Z',
  dataPoints: [
    { id: 'p1', x: '2024-01', y: 10, series: null, dimensions: null, createdAt: '2024-01-01T00:00:00Z' },
    { id: 'p2', x: '2024-02', y: 20, series: null, dimensions: null, createdAt: '2024-01-01T00:00:00Z' },
  ],
})

// ---------------------------------------------------------------------------
// CustomReportView
// ---------------------------------------------------------------------------

describe('CustomReportView', () => {
  it('shows empty state when report has no widgets', () => {
    render(<CustomReportView report={makeReport()} />)
    expect(screen.getByText('No widgets yet')).toBeInTheDocument()
  })

  it('renders one widget card per widget in the report', () => {
    const report = makeReport({
      widgets: [makeWidget('line'), { ...makeWidget('bar'), id: 'w2', title: 'bar chart', position: 1 }],
    })
    render(<CustomReportView report={report} />)
    expect(screen.getByText('line chart')).toBeInTheDocument()
    expect(screen.getByText('bar chart')).toBeInTheDocument()
  })

  it('renders filters when present', () => {
    const report = makeReport({
      filters: [
        {
          id: 'f1',
          customReportId: 'r1',
          key: 'team',
          label: 'Team',
          kind: 'select',
          defaultValue: null,
          position: 0,
        },
      ],
    })
    render(<CustomReportView report={report} />)
    expect(screen.getByText('Team')).toBeInTheDocument()
  })
})
