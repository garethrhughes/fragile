'use client'

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { useReplaceParams } from '@/hooks/use-page-params'
import { useBoardsStore } from '@/store/boards-store'
import type { TimePeriodWindow } from '@/lib/api'

/** Sentinel board value meaning "all boards". */
export const ALL_BOARDS = 'All'

/** The three period modes shared by the DORA and Cycle Time reports. */
export type PeriodMode = 'quarter' | 'sprint' | 'timeperiod'

/** Valid rolling time-period windows in days. */
export const TIME_PERIOD_WINDOWS: readonly TimePeriodWindow[] = [7, 30, 90] as const

/** Default state applied when no URL params are present. */
const DEFAULT_MODE: PeriodMode = 'quarter'
const DEFAULT_WINDOW: TimePeriodWindow = 90

export interface PeriodFilterState {
  /** Selected board key, or ALL_BOARDS. */
  board: string
  /** Whether the "All boards" option is selected. */
  isAllBoards: boolean
  /** Comma-separated board IDs to send to the API (undefined = all boards). */
  boardIdForApi: string | undefined
  /** Selected period mode. */
  mode: PeriodMode
  /** Selected quarter (YYYY-QN) when mode='quarter'. */
  quarter: string | null
  /** Selected sprint ID when mode='sprint'. */
  sprintId: string | null
  /** Selected rolling window (days) when mode='timeperiod'. */
  window: TimePeriodWindow
  /** True when the sprint option is selectable (single Scrum board). */
  sprintAvailable: boolean
  /** Setters — all write to the URL via replaceParams. */
  setBoard: (board: string) => void
  setMode: (mode: PeriodMode) => void
  setQuarter: (quarter: string | null) => void
  setSprintId: (sprintId: string | null) => void
  setWindow: (window: TimePeriodWindow) => void
}

function parseWindow(raw: string | null): TimePeriodWindow {
  const n = Number(raw)
  return (TIME_PERIOD_WINDOWS as readonly number[]).includes(n)
    ? (n as TimePeriodWindow)
    : DEFAULT_WINDOW
}

function parseMode(raw: string | null): PeriodMode {
  return raw === 'quarter' || raw === 'sprint' || raw === 'timeperiod'
    ? raw
    : DEFAULT_MODE
}

/**
 * Reads and writes the unified reporting-period filter state from the URL.
 * Shared by the DORA and Cycle Time pages so both behave identically
 * (proposal 0079). URL params: board, mode, quarter, sprintId, window.
 */
export function usePeriodFilter(): PeriodFilterState {
  const searchParams = useSearchParams()
  const replaceParams = useReplaceParams()

  const allBoards = useBoardsStore((s) => s.allBoards)
  const kanbanBoardIds = useBoardsStore((s) => s.kanbanBoardIds)
  const boardsStatus = useBoardsStore((s) => s.status)

  const boardParam = searchParams.get('board')
  const board = boardParam ?? ALL_BOARDS
  const isAllBoards = board === ALL_BOARDS

  const mode = parseMode(searchParams.get('mode'))
  const quarter = searchParams.get('quarter')
  const sprintId = searchParams.get('sprintId')
  const window = parseWindow(searchParams.get('window'))

  // Sprint is only valid for a single, non-Kanban board.
  const sprintAvailable = useMemo(
    () =>
      boardsStatus === 'ready' &&
      !isAllBoards &&
      allBoards.includes(board) &&
      !kanbanBoardIds.has(board),
    [boardsStatus, isAllBoards, allBoards, board, kanbanBoardIds],
  )

  const boardIdForApi = isAllBoards ? undefined : board

  // Setters are memoized so the returned object is stable enough to use in
  // effect dependency arrays without churning on every render. replaceParams is
  // itself memoized (useReplaceParams).
  const setBoard = useCallback(
    (next: string) => replaceParams({ board: next === ALL_BOARDS ? null : next }),
    [replaceParams],
  )
  const setMode = useCallback(
    (next: PeriodMode) => replaceParams({ mode: next }),
    [replaceParams],
  )
  const setQuarter = useCallback(
    (next: string | null) => replaceParams({ quarter: next }),
    [replaceParams],
  )
  const setSprintId = useCallback(
    (next: string | null) => replaceParams({ sprintId: next }),
    [replaceParams],
  )
  const setWindow = useCallback(
    (next: TimePeriodWindow) => replaceParams({ window: String(next) }),
    [replaceParams],
  )

  return useMemo(
    () => ({
      board,
      isAllBoards,
      boardIdForApi,
      mode,
      quarter,
      sprintId,
      window,
      sprintAvailable,
      setBoard,
      setMode,
      setQuarter,
      setSprintId,
      setWindow,
    }),
    [
      board,
      isAllBoards,
      boardIdForApi,
      mode,
      quarter,
      sprintId,
      window,
      sprintAvailable,
      setBoard,
      setMode,
      setQuarter,
      setSprintId,
      setWindow,
    ],
  )
}
