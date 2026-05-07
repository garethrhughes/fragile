import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CycleTimePercentileCard } from './cycle-time-percentile-card'

describe('CycleTimePercentileCard', () => {
  it('renders the percentile label and days value', () => {
    render(
      <CycleTimePercentileCard
        percentile="p50"
        days={3.4}
        sampleSize={12}
        band="good"
      />,
    )
    expect(screen.getByText(/Median \(p50\)/i)).toBeInTheDocument()
    expect(screen.getByText('3.4')).toBeInTheDocument()
    expect(screen.getByText('n=12')).toBeInTheDocument()
  })

  it('uses "working days" label by default', () => {
    render(
      <CycleTimePercentileCard
        percentile="p95"
        days={9.0}
        sampleSize={5}
        band="fair"
      />,
    )
    expect(screen.getByText(/working days/i)).toBeInTheDocument()
  })

  it('uses "calendar days" label when excludeWeekends=false', () => {
    render(
      <CycleTimePercentileCard
        percentile="p95"
        days={9.0}
        sampleSize={5}
        band="fair"
        excludeWeekends={false}
      />,
    )
    expect(screen.getByText(/calendar days/i)).toBeInTheDocument()
  })

  // Proposal 0054 AC E: when no completed cycles exist, days and band are
  // null. The card must render an em-dash placeholder, not "0.0".
  it('renders em-dash and no band badge when days is null', () => {
    render(
      <CycleTimePercentileCard
        percentile="p50"
        days={null}
        sampleSize={0}
        band={null}
      />,
    )
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0.0')).not.toBeInTheDocument()
    expect(screen.queryByText(/excellent|good|fair|poor/i)).not.toBeInTheDocument()
  })
})
