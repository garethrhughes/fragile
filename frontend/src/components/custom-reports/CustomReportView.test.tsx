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
import { render, screen, fireEvent } from '@testing-library/react'
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
import { CustomReportFilters } from './CustomReportFilters'

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

const makeWidget = (
  kind: 'line' | 'bar' | 'area' | 'table' = 'line',
  id = 'w1',
): CustomReportWidgetType => ({
  id,
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
// CustomReportView — basic rendering
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

// ---------------------------------------------------------------------------
// CustomReportView — layout: grid column classes
// ---------------------------------------------------------------------------

describe('CustomReportView — layout grid', () => {
  it('applies lg:grid-cols-2 by default when layout is null', () => {
    const report = makeReport({ widgets: [makeWidget('line')] })
    const { container } = render(<CustomReportView report={report} />)
    const grid = container.querySelector('.lg\\:grid-cols-2')
    expect(grid).toBeInTheDocument()
  })

  it('applies lg:grid-cols-3 when layout.defaultColumns is 3', () => {
    const report = makeReport({
      layout: { defaultColumns: 3 },
      widgets: [makeWidget('line')],
    })
    const { container } = render(<CustomReportView report={report} />)
    const grid = container.querySelector('.lg\\:grid-cols-3')
    expect(grid).toBeInTheDocument()
  })

  it('wraps a non-table widget in lg:col-span-1 by default', () => {
    const report = makeReport({
      layout: { defaultColumns: 3 },
      widgets: [makeWidget('line', 'w1')],
    })
    const { container } = render(<CustomReportView report={report} />)
    const wrapper = container.querySelector('.lg\\:col-span-1')
    expect(wrapper).toBeInTheDocument()
  })

  it('wraps a table widget in full-width col-span by default', () => {
    const report = makeReport({
      layout: { defaultColumns: 3 },
      widgets: [{ ...makeWidget('table', 'w1'), columns: [] }],
    })
    const { container } = render(<CustomReportView report={report} />)
    const wrapper = container.querySelector('.lg\\:col-span-3')
    expect(wrapper).toBeInTheDocument()
  })

  it('respects explicit colSpan override for a table widget', () => {
    const report = makeReport({
      layout: { defaultColumns: 3, widgets: { w1: { colSpan: 2 } } },
      widgets: [{ ...makeWidget('table', 'w1'), columns: [] }],
    })
    const { container } = render(<CustomReportView report={report} />)
    // Should be col-span-2, not col-span-3
    expect(container.querySelector('.lg\\:col-span-2')).toBeInTheDocument()
    expect(container.querySelector('.lg\\:col-span-3')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// CustomReportFilters — comma-separated input bug fix
// ---------------------------------------------------------------------------

describe('CustomReportFilters — comma-separated input', () => {
  const multiFilter = {
    id: 'f1',
    customReportId: 'r1',
    key: 'team',
    label: 'Team',
    kind: 'multiselect' as const,
    defaultValue: null,
    position: 0,
  }

  it('accepts comma characters while typing (does not strip them)', () => {
    const onChange = vi.fn()
    render(
      <CustomReportFilters
        filters={[multiFilter]}
        options={{}}
        values={{}}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: /comma-separated/i })
    fireEvent.change(input, { target: { value: 'foo,' } })
    // The raw input value should contain the comma — onChange not called yet (no blur)
    expect((input as HTMLInputElement).value).toBe('foo,')
  })

  it('splits on comma and trims values when input is blurred', () => {
    const onChange = vi.fn()
    render(
      <CustomReportFilters
        filters={[multiFilter]}
        options={{}}
        values={{}}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: /comma-separated/i })
    fireEvent.change(input, { target: { value: 'foo, bar, baz' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith('team', ['foo', 'bar', 'baz'])
  })

  it('calls onChange with undefined when input is cleared and blurred', () => {
    const onChange = vi.fn()
    render(
      <CustomReportFilters
        filters={[multiFilter]}
        options={{}}
        values={{ team: ['foo'] }}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('textbox', { name: /comma-separated/i })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('team', undefined)
  })
})
