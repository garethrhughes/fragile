import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthCheckPanel } from './health-check-panel'
import type { HealthCheckReport } from '@/lib/api'

function makeReport(overrides: Partial<HealthCheckReport> = {}): HealthCheckReport {
  return {
    boards: [
      {
        boardId: 'ACC',
        boardType: 'scrum',
        stabilityScore: 90,
        stabilityBand: 'healthy',
        roadmapScore: 75,
        roadmapBand: 'watch',
        volume: { boardType: 'scrum', committed: 18, added: 2, completed: 8, onRoadmap: 6, support: 3 },
        trend: [
          { week: '2026-W17', stabilityScore: 80, roadmapScore: 70 },
          { week: '2026-W18', stabilityScore: 85, roadmapScore: 72 },
          { week: '2026-W19', stabilityScore: 88, roadmapScore: 74 },
          { week: '2026-W20', stabilityScore: 90, roadmapScore: 75 },
        ],
      },
    ],
    stabilityDistribution: { healthy: 1, watch: 0, atRisk: 0, na: 0 },
    roadmapDistribution: { healthy: 0, watch: 1, atRisk: 0, na: 0 },
    ...overrides,
  }
}

describe('HealthCheckPanel', () => {
  it('renders the panel heading', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    expect(screen.getByRole('heading', { name: 'Health Check' })).toBeInTheDocument()
  })

  it('shows the stability score and scrum volume context', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    expect(screen.getByText('90%')).toBeInTheDocument()
    expect(screen.getByText('committed 18 · added 2 · completed 8')).toBeInTheDocument()
  })

  it('shows roadmap delivery as X of Y completed on-roadmap with support context', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    // 75% of 8 completed = 6 on-roadmap; 3 support shown as context
    expect(
      screen.getByText('6 of 8 completed on-roadmap · 3 support (context)'),
    ).toBeInTheDocument()
  })

  it('renders n/a for a board that completed nothing', () => {
    const report = makeReport({
      boards: [
        {
          boardId: 'BPT',
          boardType: 'scrum',
          stabilityScore: 100,
          stabilityBand: 'healthy',
          roadmapScore: null,
          roadmapBand: null,
          volume: { boardType: 'scrum', committed: 10, added: 0, completed: 0, onRoadmap: 0, support: 0 },
          trend: [{ week: '2026-W20', stabilityScore: 100, roadmapScore: null }],
        },
      ],
      roadmapDistribution: { healthy: 0, watch: 0, atRisk: 0, na: 1 },
    })
    render(<HealthCheckPanel report={report} />)
    expect(screen.getByText('n/a')).toBeInTheDocument()
    expect(screen.getByText('nothing completed')).toBeInTheDocument()
  })

  it('renders the org distribution as band counts, not a single average', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    expect(screen.getByText('1 healthy')).toBeInTheDocument()
    expect(screen.getByText('1 watch')).toBeInTheDocument()
  })

  it('shows kanban volume with pulled-in wording', () => {
    const report = makeReport({
      boards: [
        {
          boardId: 'PLAT',
          boardType: 'kanban',
          stabilityScore: 60,
          stabilityBand: 'at-risk',
          roadmapScore: 50,
          roadmapBand: 'at-risk',
          volume: { boardType: 'kanban', pulledIn: 10, completed: 6, onRoadmap: 3, support: 0 },
          trend: [{ week: '2026-W20', stabilityScore: 60, roadmapScore: 50 }],
        },
      ],
    })
    render(<HealthCheckPanel report={report} />)
    expect(screen.getByText('pulled in 10 · completed 6')).toBeInTheDocument()
  })
})
