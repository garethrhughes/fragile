'use client'

import { BoardChip } from '@/components/ui/board-chip'
import { QuarterSelect } from '@/components/ui/quarter-select'
import { SprintSelect } from '@/components/ui/sprint-select'
import {
  ALL_BOARDS,
  TIME_PERIOD_WINDOWS,
  type PeriodMode,
} from '@/hooks/use-period-filter'
import type { TimePeriodWindow } from '@/lib/api'

interface PeriodFilterBarProps {
  allBoards: string[]
  kanbanBoardIds: Set<string>
  board: string
  isAllBoards: boolean
  mode: PeriodMode
  quarter: string | null
  sprintId: string | null
  window: TimePeriodWindow
  sprintAvailable: boolean
  onBoardChange: (board: string) => void
  onModeChange: (mode: PeriodMode) => void
  onQuarterChange: (quarter: string | null) => void
  onSprintChange: (sprintId: string | null) => void
  onWindowChange: (window: TimePeriodWindow) => void
}

const MODE_OPTIONS: ReadonlyArray<{ value: PeriodMode; label: string }> = [
  { value: 'quarter', label: 'Quarter' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'timeperiod', label: 'Time period' },
]

const WINDOW_LABELS: Record<TimePeriodWindow, string> = {
  7: 'Last 7 days',
  30: 'Last 30 days',
  90: 'Last 90 days',
}

/**
 * Unified reporting-period filter bar shared by the DORA and Cycle Time pages
 * (proposal 0079). Renders a single-select board control with an "All" entry,
 * a Quarter | Sprint | Time period toggle, and the dropdown for the active mode.
 * Sprint is disabled unless a single Scrum board is selected.
 */
export function PeriodFilterBar({
  allBoards,
  kanbanBoardIds,
  board,
  isAllBoards,
  mode,
  quarter,
  sprintId,
  window,
  sprintAvailable,
  onBoardChange,
  onModeChange,
  onQuarterChange,
  onSprintChange,
  onWindowChange,
}: PeriodFilterBarProps) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      {/* Board selector — single select with All option */}
      <div>
        <label className="mb-2 block text-sm font-medium text-muted">Board</label>
        <div className="flex flex-wrap gap-2">
          <BoardChip
            boardId={ALL_BOARDS}
            selected={isAllBoards}
            onClick={() => onBoardChange(ALL_BOARDS)}
          />
          {allBoards.map((boardId) => {
            const isKanban = kanbanBoardIds.has(boardId)
            // Kanban boards cannot be selected while in sprint mode.
            const disabled = mode === 'sprint' && isKanban
            return (
              <BoardChip
                key={boardId}
                boardId={boardId}
                selected={!isAllBoards && board === boardId}
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onBoardChange(boardId)
                }}
              />
            )
          })}
        </div>
      </div>

      {/* Period mode toggle */}
      <div>
        <label className="mb-2 block text-sm font-medium text-muted">Period</label>
        <div className="inline-flex rounded-lg border border-border">
          {MODE_OPTIONS.map((opt, idx) => {
            const isSprintOpt = opt.value === 'sprint'
            const disabled = isSprintOpt && !sprintAvailable
            const active = mode === opt.value
            const rounded =
              idx === 0
                ? 'rounded-l-lg'
                : idx === MODE_OPTIONS.length - 1
                  ? 'rounded-r-lg'
                  : ''
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!disabled) onModeChange(opt.value)
                }}
                className={`${rounded} px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-interactive-selected-bg text-interactive-selected-fg'
                    : disabled
                      ? 'cursor-not-allowed text-muted opacity-40'
                      : 'text-muted hover:bg-interactive-hover-bg'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        {!sprintAvailable && (
          <p className="mt-2 text-xs text-muted">
            Sprint mode requires a single Scrum board
          </p>
        )}
      </div>

      {/* Active mode's selector */}
      <div className="max-w-xs">
        {mode === 'quarter' && (
          <QuarterSelect value={quarter} onChange={onQuarterChange} />
        )}
        {mode === 'sprint' && (
          <SprintSelect
            boardId={isAllBoards ? undefined : board}
            value={sprintId}
            onChange={onSprintChange}
          />
        )}
        {mode === 'timeperiod' && (
          <div className="relative">
            <select
              value={String(window)}
              onChange={(e) => onWindowChange(Number(e.target.value) as TimePeriodWindow)}
              className="w-full appearance-none rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
              aria-label="Time period"
            >
              {TIME_PERIOD_WINDOWS.map((w) => (
                <option key={w} value={String(w)}>
                  {WINDOW_LABELS[w]}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <svg
                className="h-4 w-4 text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
