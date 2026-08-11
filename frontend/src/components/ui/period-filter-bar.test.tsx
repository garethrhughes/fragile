import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PeriodFilterBar } from './period-filter-bar'

// QuarterSelect / SprintSelect self-fetch on mount — stub the API layer.
vi.mock('@/lib/api', () => ({
  getQuarters: vi.fn().mockResolvedValue([]),
  getSprints: vi.fn().mockResolvedValue([]),
}))

const baseProps = {
  allBoards: ['ACC', 'PLAT'],
  kanbanBoardIds: new Set<string>(['PLAT']),
  board: 'All',
  isAllBoards: true,
  mode: 'timeperiod' as const,
  quarter: null,
  sprintId: null,
  window: 90 as const,
  sprintAvailable: false,
  onBoardChange: vi.fn(),
  onModeChange: vi.fn(),
  onQuarterChange: vi.fn(),
  onSprintChange: vi.fn(),
  onWindowChange: vi.fn(),
}

describe('PeriodFilterBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an All board chip plus one chip per board', () => {
    render(<PeriodFilterBar {...baseProps} />)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ACC' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PLAT' })).toBeInTheDocument()
  })

  it('renders exactly the three period options', () => {
    render(<PeriodFilterBar {...baseProps} />)
    expect(screen.getByRole('button', { name: 'Quarter' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sprint' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Time period' })).toBeInTheDocument()
  })

  it('disables the Sprint option when sprintAvailable is false', () => {
    render(<PeriodFilterBar {...baseProps} sprintAvailable={false} />)
    expect(screen.getByRole('button', { name: 'Sprint' })).toBeDisabled()
    expect(
      screen.getByText('Sprint mode requires a single Scrum board'),
    ).toBeInTheDocument()
  })

  it('enables the Sprint option when sprintAvailable is true', () => {
    render(
      <PeriodFilterBar
        {...baseProps}
        board="ACC"
        isAllBoards={false}
        sprintAvailable
      />,
    )
    expect(screen.getByRole('button', { name: 'Sprint' })).not.toBeDisabled()
  })

  it('shows the time-period dropdown with the three windows in timeperiod mode', () => {
    render(<PeriodFilterBar {...baseProps} mode="timeperiod" />)
    const select = screen.getByLabelText('Time period')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last 7 days' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last 30 days' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Last 90 days' })).toBeInTheDocument()
  })

  it('calls onWindowChange with the numeric window on change', () => {
    const onWindowChange = vi.fn()
    render(
      <PeriodFilterBar {...baseProps} mode="timeperiod" onWindowChange={onWindowChange} />,
    )
    fireEvent.change(screen.getByLabelText('Time period'), { target: { value: '7' } })
    expect(onWindowChange).toHaveBeenCalledWith(7)
  })

  it('calls onBoardChange when a board chip is clicked', () => {
    const onBoardChange = vi.fn()
    render(<PeriodFilterBar {...baseProps} onBoardChange={onBoardChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'ACC' }))
    expect(onBoardChange).toHaveBeenCalledWith('ACC')
  })

  it('disables Kanban board chips while in sprint mode', () => {
    render(
      <PeriodFilterBar
        {...baseProps}
        board="ACC"
        isAllBoards={false}
        mode="sprint"
        sprintAvailable
      />,
    )
    // PLAT is kanban → disabled in sprint mode.
    expect(screen.getByRole('button', { name: 'PLAT' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'ACC' })).not.toBeDisabled()
  })

  it('calls onModeChange when a period option is clicked', () => {
    const onModeChange = vi.fn()
    render(<PeriodFilterBar {...baseProps} onModeChange={onModeChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Quarter' }))
    expect(onModeChange).toHaveBeenCalledWith('quarter')
  })
})
