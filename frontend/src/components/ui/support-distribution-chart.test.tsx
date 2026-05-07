import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SupportDistributionChart } from './support-distribution-chart'

// Recharts uses ResizeObserver internally
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

describe('SupportDistributionChart', () => {
  it('renders "No data" when totalIssues is 0', () => {
    render(<SupportDistributionChart supportIssues={0} totalIssues={0} />)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })

  it('renders chart container when there is data', () => {
    const { container } = render(
      <SupportDistributionChart supportIssues={10} totalIssues={100} />,
    )
    // ResponsiveContainer renders a div wrapper
    expect(container.firstChild).toBeInTheDocument()
  })

  it('does not render "No data" when there are issues', () => {
    render(<SupportDistributionChart supportIssues={5} totalIssues={50} />)
    expect(screen.queryByText('No data')).not.toBeInTheDocument()
  })
})
