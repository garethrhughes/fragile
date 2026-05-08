/**
 * Tests for CustomReportView and CustomReportGraph components (AC7).
 *
 * Strategy:
 *  - Recharts renders SVG — jsdom renders it but chart-specific internals are not
 *    testable without canvas mocks. We assert the container element and title text.
 *  - CustomReportView is tested with mock report data; applyFilters is already
 *    unit-tested in custom-report-filtering.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CustomReport, CustomReportSummary } from '@/lib/api'

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
import { CustomReportGraph } from './CustomReportGraph'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeReport = (overrides?: Partial<CustomReport>): CustomReport => ({
  id: 'r1',
  slug: 'demo',
  title: 'Demo Report',
  description: null,
  graphs: [],
  filters: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

const makeGraph = (kind: 'line' | 'bar' | 'area' = 'line') => ({
  id: 'g1',
  customReportId: 'r1',
  kind,
  title: `${kind} chart`,
  position: 0,
  seriesKey: null,
  xAxisLabel: null,
  yAxisLabel: null,
  dataPoints: [
    { id: 'p1', customReportGraphId: 'g1', x: '2024-01', y: 10, series: null, dimensions: null, createdAt: '2024-01-01T00:00:00Z' },
    { id: 'p2', customReportGraphId: 'g1', x: '2024-02', y: 20, series: null, dimensions: null, createdAt: '2024-01-01T00:00:00Z' },
  ],
})

// ---------------------------------------------------------------------------
// CustomReportGraph
// ---------------------------------------------------------------------------

describe('CustomReportGraph', () => {
  it('renders the graph title', () => {
    const graph = makeGraph('line')
    render(<CustomReportGraph graph={graph} filteredPoints={graph.dataPoints} />)
    expect(screen.getByText('line chart')).toBeInTheDocument()
  })

  it('renders a chart container for line kind', () => {
    const graph = makeGraph('line')
    const { container } = render(<CustomReportGraph graph={graph} filteredPoints={graph.dataPoints} />)
    // ResponsiveContainer renders a div wrapper; title is inside the card
    expect(container.querySelector('h3')).toBeInTheDocument()
    expect(screen.getByText('line chart')).toBeInTheDocument()
  })

  it('renders a chart container for bar kind', () => {
    const graph = makeGraph('bar')
    render(<CustomReportGraph graph={graph} filteredPoints={graph.dataPoints} />)
    expect(screen.getByText('bar chart')).toBeInTheDocument()
  })

  it('renders a chart container for area kind', () => {
    const graph = makeGraph('area')
    render(<CustomReportGraph graph={graph} filteredPoints={graph.dataPoints} />)
    expect(screen.getByText('area chart')).toBeInTheDocument()
  })

  it('renders with empty points without crashing', () => {
    const graph = makeGraph()
    render(<CustomReportGraph graph={graph} filteredPoints={[]} />)
    expect(screen.getByText('line chart')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// CustomReportView
// ---------------------------------------------------------------------------

describe('CustomReportView', () => {
  it('shows empty state when report has no graphs', () => {
    render(<CustomReportView report={makeReport()} />)
    expect(screen.getByText('No graphs yet')).toBeInTheDocument()
  })

  it('renders one graph card per graph in the report (AC7)', () => {
    const report = makeReport({
      graphs: [makeGraph('line'), { ...makeGraph('bar'), id: 'g2', title: 'bar chart', position: 1 }],
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
