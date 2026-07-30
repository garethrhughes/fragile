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
        roadmapDeliveryTarget: 80,
        supportLoadScore: 15,
        volume: { boardType: 'scrum', committed: 18, added: 2, completed: 8, onRoadmap: 6, support: 3 },
        trend: [
          { week: '2026-W17', stabilityScore: 80, roadmapScore: 70, supportLoadScore: 10 },
          { week: '2026-W18', stabilityScore: 85, roadmapScore: 72, supportLoadScore: 12 },
          { week: '2026-W19', stabilityScore: 88, roadmapScore: 74, supportLoadScore: 14 },
          { week: '2026-W20', stabilityScore: 90, roadmapScore: 75, supportLoadScore: 15 },
        ],
      },
    ],
    stabilityDistribution: { healthy: 1, watch: 0, atRisk: 0, na: 0 },
    roadmapDistribution: { healthy: 0, watch: 1, atRisk: 0, na: 0 },
    overallStabilityScore: 90,
    overallRoadmapScore: 94,
    overallSupportLoad: 15,
    totalSupportCount: 3,
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
    expect(screen.getAllByText('90%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('committed 18 · added 2 · completed 8')).toBeInTheDocument()
  })

  it('shows roadmap delivery as X of Y completed on-roadmap', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    // 75% of 8 completed = 6 on-roadmap (support is now its own column, not appended here)
    expect(screen.getByText('6 of 8 completed on-roadmap')).toBeInTheDocument()
  })

  it('shows the per-team support load as "X% (n of m)", not RAG-coloured', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    // 3 support of (18 committed + 2 added) = 20 items
    const badge = screen.getByText('15% (3 of 20)')
    expect(badge).toBeInTheDocument()
    // context styling — muted, not a RAG colour class
    expect(badge.className).not.toMatch(/green|yellow|red/)
    expect(badge.className).toContain('text-muted')
  })

  it('shows the org support load percentage and total count', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    // "Support load" appears as both the org card label and the table column header
    expect(screen.getAllByText('Support load').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('3 items')).toBeInTheDocument()
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
          roadmapDeliveryTarget: 80,
          supportLoadScore: 0,
          volume: { boardType: 'scrum', committed: 10, added: 0, completed: 0, onRoadmap: 0, support: 0 },
          trend: [{ week: '2026-W20', stabilityScore: 100, roadmapScore: null, supportLoadScore: 0 }],
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
          roadmapDeliveryTarget: 50,
          supportLoadScore: 30,
          volume: { boardType: 'kanban', pulledIn: 10, completed: 6, onRoadmap: 3, support: 3 },
          trend: [{ week: '2026-W20', stabilityScore: 60, roadmapScore: 50, supportLoadScore: 30 }],
        },
      ],
    })
    render(<HealthCheckPanel report={report} />)
    expect(screen.getByText('pulled in 10 · completed 6')).toBeInTheDocument()
    // kanban support load uses pulled-in as the denominator
    expect(screen.getByText('30% (3 of 10)')).toBeInTheDocument()
  })

  it('shows the org overall stability and roadmap scores', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    expect(screen.getByText('Org stability')).toBeInTheDocument()
    expect(screen.getByText('Org roadmap')).toBeInTheDocument()
    expect(screen.getAllByText('90%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('94%')).toBeInTheDocument()
  })

  it('shows each team roadmap target', () => {
    render(<HealthCheckPanel report={makeReport()} />)
    expect(screen.getByText('target 80%')).toBeInTheDocument()
  })

  it('renders n/a for org roadmap when null', () => {
    render(<HealthCheckPanel report={makeReport({ overallRoadmapScore: null })} />)
    const orgRoadmap = screen.getByText('Org roadmap').closest('div')
    expect(orgRoadmap?.textContent).toContain('n/a')
  })
})
