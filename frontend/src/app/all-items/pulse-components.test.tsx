import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  TotalsStrip,
  BoardTable,
  BoardRow,
} from './pulse-components'
import type { AllItemsBoardResult, AllItemsTotals } from '@/lib/api'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTotals(overrides: Partial<AllItemsTotals> = {}): AllItemsTotals {
  return {
    totalItems: 47,
    startedCount: 20,
    addedMidSprintCount: 3,
    completedCount: 14,
    onRoadmapCount: 11,
    supportCount: 4,
    ttbSupportCount: 1,
    inFlightCount: 22,
    ...overrides,
  }
}

function makeBoard(overrides: Partial<AllItemsBoardResult> = {}): AllItemsBoardResult {
  return {
    boardId: 'ACC',
    boardType: 'scrum',
    items: [],
    summary: {
      totalItems: 12,
      startedCount: 8,
      addedMidSprintCount: 2,
      completedCount: 9,
      onRoadmapCount: 7,
      supportCount: 1,
      ttbSupportCount: 0,
      inFlightCount: 0,
    },
    healthScore: {
      overall: 91,
      roadmapAlignmentScore: 88,
      supportBurdenScore: 95,
      stabilityScore: 83,
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// TotalsStrip
// ---------------------------------------------------------------------------

describe('TotalsStrip', () => {
  it('renders total items count', () => {
    render(<TotalsStrip totals={makeTotals()} overallScore={89} />)
    expect(screen.getByText('47')).toBeInTheDocument()
  })

  it('renders completed count', () => {
    render(<TotalsStrip totals={makeTotals()} overallScore={89} />)
    expect(screen.getByText('14')).toBeInTheDocument()
  })

  it('renders overall score', () => {
    render(<TotalsStrip totals={makeTotals()} overallScore={89} />)
    expect(screen.getByText('89')).toBeInTheDocument()
  })

  it('renders support count', () => {
    render(<TotalsStrip totals={makeTotals()} overallScore={89} />)
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// BoardRow
// ---------------------------------------------------------------------------

describe('BoardRow', () => {
  it('renders board id', () => {
    render(
      <table><tbody>
        <BoardRow board={makeBoard()} />
      </tbody></table>,
    )
    expect(screen.getByText('ACC')).toBeInTheDocument()
  })

  it('renders board type', () => {
    render(
      <table><tbody>
        <BoardRow board={makeBoard()} />
      </tbody></table>,
    )
    expect(screen.getByText('scrum')).toBeInTheDocument()
  })

  it('renders health score', () => {
    render(
      <table><tbody>
        <BoardRow board={makeBoard()} />
      </tbody></table>,
    )
    expect(screen.getByText('91')).toBeInTheDocument()
  })

  it('renders completed count in row', () => {
    render(
      <table><tbody>
        <BoardRow board={makeBoard()} />
      </tbody></table>,
    )
    expect(screen.getByText('9')).toBeInTheDocument()
  })

  it('shows dash in In Flight column for scrum boards', () => {
    render(
      <table><tbody>
        <BoardRow board={makeBoard({ boardType: 'scrum' })} />
      </tbody></table>,
    )
    // scrum boards show — for in-flight
    const cells = screen.getAllByText('—')
    expect(cells.length).toBeGreaterThanOrEqual(1)
  })

  it('shows dash in Added column for kanban boards', () => {
    render(
      <table><tbody>
        <BoardRow board={makeBoard({ boardType: 'kanban', boardId: 'PLAT' })} />
      </tbody></table>,
    )
    const cells = screen.getAllByText('—')
    expect(cells.length).toBeGreaterThanOrEqual(1)
  })

  it('expands issue table when expand button clicked', () => {
    const board = makeBoard({
      items: [
        {
          key: 'ACC-1',
          summary: 'Test issue',
          issueType: 'Story',
          status: 'Done',
          boardId: 'ACC',
          assignee: null,
          points: null,
          labels: [],
          jiraUrl: '',
          epicKey: null,
          sprintName: 'Sprint 1',
          started: false,
          addedMidSprint: false,
          kanbanAdd: false,
          completed: true,
          onRoadmap: false,
          isSupport: false,
          isTtbSupport: false,
          inFlight: false,
        },
      ],
    })
    render(
      <table><tbody>
        <BoardRow board={board} />
      </tbody></table>,
    )
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(screen.getByText('ACC-1')).toBeInTheDocument()
  })

  it('collapses issue table when expand button clicked again', () => {
    const board = makeBoard({
      items: [
        {
          key: 'ACC-1',
          summary: 'Test issue',
          issueType: 'Story',
          status: 'Done',
          boardId: 'ACC',
          assignee: null,
          points: null,
          labels: [],
          jiraUrl: '',
          epicKey: null,
          sprintName: null,
          started: false,
          addedMidSprint: false,
          kanbanAdd: false,
          completed: true,
          onRoadmap: false,
          isSupport: false,
          isTtbSupport: false,
          inFlight: false,
        },
      ],
    })
    render(
      <table><tbody>
        <BoardRow board={board} />
      </tbody></table>,
    )
    const btn = screen.getByRole('button', { name: /expand/i })
    fireEvent.click(btn)
    expect(screen.getByText('ACC-1')).toBeInTheDocument()
    fireEvent.click(btn)
    expect(screen.queryByText('ACC-1')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// BoardTable
// ---------------------------------------------------------------------------

describe('BoardTable', () => {
  it('renders a row for each board', () => {
    const boards = [
      makeBoard({ boardId: 'ACC' }),
      makeBoard({ boardId: 'BPT' }),
    ]
    render(<BoardTable boards={boards} />)
    expect(screen.getByText('ACC')).toBeInTheDocument()
    expect(screen.getByText('BPT')).toBeInTheDocument()
  })

  it('renders empty state when no boards', () => {
    render(<BoardTable boards={[]} />)
    expect(screen.getByText(/no boards configured/i)).toBeInTheDocument()
  })
})
