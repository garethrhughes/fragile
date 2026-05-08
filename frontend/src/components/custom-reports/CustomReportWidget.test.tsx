/**
 * Tests for TableWidget, StatWidget, and StatusBadge (proposal 0057 AC7–AC10).
 *
 * DataTable already has its own tests for sort behaviour.
 * These tests focus on the column renderers and stat card rendering.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { CustomReportWidget, CustomReportDataPoint, ColumnDefinition } from '@/lib/api'

// Recharts ResizeObserver polyfill
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/lib/api', () => ({}))

import { TableWidget, projectPoints } from './widgets/TableWidget'
import { StatWidget } from './widgets/StatWidget'
import { StatusBadge } from '../ui/status-badge'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeWidget = (overrides: Partial<CustomReportWidget> = {}): CustomReportWidget => ({
  id: 'w1',
  customReportId: 'r1',
  kind: 'table',
  title: 'Issues',
  seriesKey: null,
  xAxisLabel: null,
  yAxisLabel: null,
  position: 0,
  columns: null,
  statUnit: null,
  statSubtitle: null,
  statBand: null,
  createdAt: '2024-01-01T00:00:00Z',
  dataPoints: [],
  ...overrides,
})

const makePoint = (overrides: Partial<CustomReportDataPoint> = {}): CustomReportDataPoint => ({
  id: 'p1',
  x: 'ACC-123',
  y: 5,
  series: null,
  dimensions: { status: 'In Progress', priority: 'High', team: 'Platform' },
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

// ---------------------------------------------------------------------------
// projectPoints
// ---------------------------------------------------------------------------

describe('projectPoints', () => {
  it('merges x, y, series with dimensions into a flat record', () => {
    const point = makePoint({ x: 'ACC-1', y: 3, series: 'backend', dimensions: { status: 'Done' } })
    const rows = projectPoints([point])
    expect(rows[0]).toMatchObject({ x: 'ACC-1', y: 3, series: 'backend', status: 'Done' })
  })

  it('handles null dimensions gracefully', () => {
    const point = makePoint({ dimensions: null })
    const rows = projectPoints([point])
    expect(rows[0].x).toBe('ACC-123')
  })
})

// ---------------------------------------------------------------------------
// StatusBadge
// ---------------------------------------------------------------------------

describe('StatusBadge', () => {
  it('renders the status text', () => {
    render(<StatusBadge status="In Progress" />)
    expect(screen.getByText('In Progress')).toBeInTheDocument()
  })

  it('applies green classes for Done status', () => {
    const { container } = render(<StatusBadge status="Done" />)
    expect(container.firstChild).toHaveClass('bg-green-100')
  })

  it('applies blue classes for In Progress status', () => {
    const { container } = render(<StatusBadge status="In Progress" />)
    expect(container.firstChild).toHaveClass('bg-blue-100')
  })

  it('applies neutral classes for unknown status', () => {
    const { container } = render(<StatusBadge status="Wontfix" />)
    expect(container.firstChild).toHaveClass('bg-gray-100')
  })
})

// ---------------------------------------------------------------------------
// TableWidget — column type renderers (AC7)
// ---------------------------------------------------------------------------

describe('TableWidget column renderers', () => {
  const JIRA_BASE = 'https://mycompany.atlassian.net'

  function renderTable(cols: ColumnDefinition[], point: CustomReportDataPoint) {
    const widget = makeWidget({ columns: cols })
    return render(<TableWidget widget={widget} filteredPoints={[point]} jiraBaseUrl={JIRA_BASE} />)
  }

  it('renders text column as plain text', () => {
    renderTable(
      [{ key: 'status', label: 'Status', type: 'text' }],
      makePoint({ dimensions: { status: 'Done' } }),
    )
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('renders number column as plain string', () => {
    renderTable(
      [{ key: 'y', label: 'Points', type: 'number' }],
      makePoint({ y: 42 }),
    )
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders status column as a StatusBadge', () => {
    renderTable(
      [{ key: 'status', label: 'Status', type: 'status' }],
      makePoint({ dimensions: { status: 'In Progress' } }),
    )
    const badge = screen.getByText('In Progress')
    expect(badge).toBeInTheDocument()
    // StatusBadge renders an inline span with border
    expect(badge.tagName.toLowerCase()).toBe('span')
  })

  it('renders priority column as a PriorityBadge', () => {
    renderTable(
      [{ key: 'priority', label: 'Priority', type: 'priority' }],
      makePoint({ dimensions: { priority: 'High' } }),
    )
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('renders issue column as a link to Jira issue', () => {
    renderTable(
      [{ key: 'x', label: 'Issue', type: 'issue' }],
      makePoint({ x: 'ACC-123' }),
    )
    const link = screen.getByRole('link', { name: 'ACC-123' })
    expect(link).toHaveAttribute('href', `${JIRA_BASE}/browse/ACC-123`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders issue column as plain text when jiraBaseUrl is empty', () => {
    const widget = makeWidget({ columns: [{ key: 'x', label: 'Issue', type: 'issue' }] })
    render(<TableWidget widget={widget} filteredPoints={[makePoint({ x: 'ACC-123' })]} jiraBaseUrl="" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('ACC-123')).toBeInTheDocument()
  })

  it('renders link column as an anchor with rel=noopener noreferrer', () => {
    renderTable(
      [{ key: 'url', label: 'Link', type: 'link' }],
      makePoint({ x: 'x', y: 0, dimensions: { url: 'https://example.com' } }),
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders link column as plain text for non-http(s) URLs', () => {
    renderTable(
      [{ key: 'url', label: 'Link', type: 'link' }],
      makePoint({ x: 'x', y: 0, dimensions: { url: 'javascript:alert(1)' } }),
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
  })

  it('uses {key}_label dimension as display text for link column', () => {
    renderTable(
      [{ key: 'url', label: 'Link', type: 'link' }],
      makePoint({ x: 'x', y: 0, dimensions: { url: 'https://example.com', url_label: 'View PR' } }),
    )
    expect(screen.getByRole('link', { name: 'View PR' })).toBeInTheDocument()
  })

  it('renders icon column as the icon name text', () => {
    renderTable(
      [{ key: 'icon', label: 'Icon', type: 'icon' }],
      makePoint({ dimensions: { icon: 'CheckCircle' } }),
    )
    expect(screen.getByText('CheckCircle')).toBeInTheDocument()
  })

  it('renders the widget title', () => {
    const widget = makeWidget({ title: 'My Table', columns: [] })
    render(<TableWidget widget={widget} filteredPoints={[]} jiraBaseUrl="" />)
    expect(screen.getByText('My Table')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// TableWidget — sort behaviour (AC8)
// ---------------------------------------------------------------------------

describe('TableWidget sort behaviour', () => {
  it('sorts rows ascending on first header click', () => {
    const cols: ColumnDefinition[] = [{ key: 'x', label: 'Issue', type: 'text', sortable: true }]
    const points = [
      makePoint({ id: 'p1', x: 'B', dimensions: null }),
      makePoint({ id: 'p2', x: 'A', dimensions: null }),
    ]
    const widget = makeWidget({ columns: cols })
    render(<TableWidget widget={widget} filteredPoints={points} jiraBaseUrl="" />)

    const header = screen.getByRole('columnheader', { name: /issue/i })
    fireEvent.click(header)

    const cells = screen.getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('A')
    expect(cells[1]).toHaveTextContent('B')
  })

  it('sorts rows descending on second header click', () => {
    const cols: ColumnDefinition[] = [{ key: 'x', label: 'Issue', type: 'text', sortable: true }]
    const points = [
      makePoint({ id: 'p1', x: 'A', dimensions: null }),
      makePoint({ id: 'p2', x: 'B', dimensions: null }),
    ]
    const widget = makeWidget({ columns: cols })
    render(<TableWidget widget={widget} filteredPoints={points} jiraBaseUrl="" />)

    const header = screen.getByRole('columnheader', { name: /issue/i })
    fireEvent.click(header) // asc
    fireEvent.click(header) // desc

    const cells = screen.getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('B')
    expect(cells[1]).toHaveTextContent('A')
  })
})

// ---------------------------------------------------------------------------
// StatWidget — band colour (AC9)
// ---------------------------------------------------------------------------

describe('StatWidget band colour', () => {
  it('renders green left border for elite band', () => {
    const widget = makeWidget({ kind: 'stat', title: 'Metric', statBand: 'elite' })
    const { container } = render(<StatWidget widget={widget} filteredPoints={[]} />)
    expect(container.firstChild).toHaveClass('border-l-green-500')
  })

  it('renders blue left border for high band', () => {
    const widget = makeWidget({ kind: 'stat', statBand: 'high' })
    const { container } = render(<StatWidget widget={widget} filteredPoints={[]} />)
    expect(container.firstChild).toHaveClass('border-l-blue-500')
  })

  it('renders amber left border for medium band', () => {
    const widget = makeWidget({ kind: 'stat', statBand: 'medium' })
    const { container } = render(<StatWidget widget={widget} filteredPoints={[]} />)
    expect(container.firstChild).toHaveClass('border-l-amber-500')
  })

  it('renders red left border for low band', () => {
    const widget = makeWidget({ kind: 'stat', statBand: 'low' })
    const { container } = render(<StatWidget widget={widget} filteredPoints={[]} />)
    expect(container.firstChild).toHaveClass('border-l-red-500')
  })

  it('renders neutral border for none band', () => {
    const widget = makeWidget({ kind: 'stat', statBand: 'none' })
    const { container } = render(<StatWidget widget={widget} filteredPoints={[]} />)
    expect(container.firstChild).toHaveClass('border-l-border')
  })

  it('renders neutral border when statBand is null', () => {
    const widget = makeWidget({ kind: 'stat', statBand: null })
    const { container } = render(<StatWidget widget={widget} filteredPoints={[]} />)
    expect(container.firstChild).toHaveClass('border-l-border')
  })
})

// ---------------------------------------------------------------------------
// StatWidget — value, unit, subtitle (AC10)
// ---------------------------------------------------------------------------

describe('StatWidget content', () => {
  it('renders the primary y value from the first data point', () => {
    const widget = makeWidget({ kind: 'stat', title: 'Lead Time' })
    const point = makePoint({ y: 3.5 })
    render(<StatWidget widget={widget} filteredPoints={[point]} />)
    expect(screen.getByText('3.5')).toBeInTheDocument()
  })

  it('renders statUnit as muted suffix', () => {
    const widget = makeWidget({ kind: 'stat', statUnit: 'days' })
    const point = makePoint({ y: 7 })
    render(<StatWidget widget={widget} filteredPoints={[point]} />)
    expect(screen.getByText('days')).toBeInTheDocument()
  })

  it('renders statSubtitle below the value', () => {
    const widget = makeWidget({ kind: 'stat', statSubtitle: 'Last 30 days' })
    render(<StatWidget widget={widget} filteredPoints={[makePoint()]} />)
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
  })

  it('renders — when no data points are present', () => {
    const widget = makeWidget({ kind: 'stat', title: 'Empty' })
    render(<StatWidget widget={widget} filteredPoints={[]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders BandBadge when statBand is non-null and not none', () => {
    const widget = makeWidget({ kind: 'stat', statBand: 'high' })
    render(<StatWidget widget={widget} filteredPoints={[makePoint()]} />)
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('does not render BandBadge when statBand is none', () => {
    const widget = makeWidget({ kind: 'stat', statBand: 'none' })
    render(<StatWidget widget={widget} filteredPoints={[makePoint()]} />)
    expect(screen.queryByText('none')).toBeNull()
  })
})
