import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompositeScoreDisplay } from './CompositeScoreDisplay'

describe('CompositeScoreDisplay', () => {
  it("renders 'Insufficient data' when compositeScore is null", () => {
    render(
      <CompositeScoreDisplay
        compositeScore={null}
        compositeBand={null}
        totalWeightApplied={0}
        excludedDimensions={[
          'deliveryRate',
          'scopeStability',
          'roadmapCoverage',
          'leadTime',
          'deploymentFrequency',
          'changeFailureRate',
          'mttr',
        ]}
      />,
    )

    expect(screen.getByText('Insufficient data')).toBeInTheDocument()
    expect(
      screen.getByText('No dimension produced a usable score for this sprint.'),
    ).toBeInTheDocument()

    // Tooltip lists excluded dimensions
    const heading = screen.getByText('Insufficient data')
    expect(heading).toHaveAttribute(
      'title',
      expect.stringContaining('Delivery Rate'),
    )
    expect(heading.getAttribute('title')).toContain('MTTR')
  })

  it('renders ~ modifier and excluded-dimension footnote when totalWeightApplied < 1', () => {
    render(
      <CompositeScoreDisplay
        compositeScore={72.4}
        compositeBand="good"
        totalWeightApplied={0.4}
        excludedDimensions={[
          'leadTime',
          'deploymentFrequency',
          'changeFailureRate',
          'mttr',
        ]}
      />,
    )

    // ~ modifier prepended to score
    expect(screen.getByText('~72.4')).toBeInTheDocument()
    // Band label still rendered
    expect(screen.getByText('Good')).toBeInTheDocument()
    // Footnote: percentage + excluded dimension labels
    const footnote = screen.getByText(/Computed from 40% of weights/)
    expect(footnote).toBeInTheDocument()
    expect(footnote.textContent).toContain('Lead Time')
    expect(footnote.textContent).toContain('Deployment Frequency')
    expect(footnote.textContent).toContain('Change Failure Rate')
    expect(footnote.textContent).toContain('MTTR')
  })

  it('renders score and band without modifier when totalWeightApplied === 1', () => {
    render(
      <CompositeScoreDisplay
        compositeScore={85.0}
        compositeBand="strong"
        totalWeightApplied={1}
        excludedDimensions={[]}
      />,
    )

    // Score shown without ~ prefix
    expect(screen.getByText('85.0')).toBeInTheDocument()
    expect(screen.queryByText('~85.0')).not.toBeInTheDocument()
    // Band label
    expect(screen.getByText('Strong')).toBeInTheDocument()
    // No footnote about partial weights
    expect(screen.queryByText(/Computed from/)).not.toBeInTheDocument()
  })
})
