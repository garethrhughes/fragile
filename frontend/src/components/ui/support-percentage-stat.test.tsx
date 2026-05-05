import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SupportPercentageStat } from './support-percentage-stat'

describe('SupportPercentageStat', () => {
  it('renders the support load heading', () => {
    render(
      <SupportPercentageStat percentage={8} supportIssues={8} totalIssues={100} />,
    )
    expect(screen.getByText('Support Load')).toBeInTheDocument()
  })

  it('renders the formatted percentage', () => {
    render(
      <SupportPercentageStat percentage={12.5} supportIssues={25} totalIssues={200} />,
    )
    expect(screen.getByText('12.5%')).toBeInTheDocument()
  })

  it('renders issue counts', () => {
    render(
      <SupportPercentageStat percentage={5} supportIssues={5} totalIssues={100} />,
    )
    expect(screen.getByText('5 support / 100 total')).toBeInTheDocument()
  })

  it('shows "low" badge when percentage ≤ 10', () => {
    render(
      <SupportPercentageStat percentage={10} supportIssues={10} totalIssues={100} />,
    )
    expect(screen.getByText('low')).toBeInTheDocument()
  })

  it('shows "moderate" badge when percentage is between 10 and 25', () => {
    render(
      <SupportPercentageStat percentage={20} supportIssues={20} totalIssues={100} />,
    )
    expect(screen.getByText('moderate')).toBeInTheDocument()
  })

  it('shows "high" badge when percentage > 25', () => {
    render(
      <SupportPercentageStat percentage={30} supportIssues={30} totalIssues={100} />,
    )
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('applies green border for low load', () => {
    const { container } = render(
      <SupportPercentageStat percentage={5} supportIssues={5} totalIssues={100} />,
    )
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('green')
  })

  it('applies red border for high load', () => {
    const { container } = render(
      <SupportPercentageStat percentage={40} supportIssues={40} totalIssues={100} />,
    )
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('red')
  })
})
