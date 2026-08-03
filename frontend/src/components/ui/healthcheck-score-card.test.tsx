import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthcheckScoreCard } from './healthcheck-score-card'
import type { HealthcheckDimension } from '@/lib/api'

function dim(overrides: Partial<HealthcheckDimension>): HealthcheckDimension {
  return { score: 50, numerator: 2, denominator: 4, band: 'amber', ...overrides }
}

describe('HealthcheckScoreCard', () => {
  it('renders the score as a percentage with numerator/denominator', () => {
    render(<HealthcheckScoreCard label="Stability" dimension={dim({ score: 75, numerator: 3, denominator: 4 })} />)
    expect(screen.getByText('75.0%')).toBeInTheDocument()
    expect(screen.getByText('3 of 4 started')).toBeInTheDocument()
  })

  it('renders an N/A empty state when the score is null', () => {
    render(
      <HealthcheckScoreCard
        label="Roadmap"
        dimension={dim({ score: null, numerator: null, denominator: 0, band: null })}
      />,
    )
    expect(screen.getByText('N/A')).toBeInTheDocument()
    expect(screen.queryByText(/started/)).not.toBeInTheDocument()
  })

  it('shows a "lower is better" hint for burden dimensions', () => {
    render(<HealthcheckScoreCard label="Support" dimension={dim({ band: 'red', score: 60 })} lowerIsBetter />)
    expect(screen.getByText(/lower is better/i)).toBeInTheDocument()
  })
})
