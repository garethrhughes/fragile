'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  getCycleTime,
  getCycleTimeTrend,
  getAppConfig,
  SnapshotPendingError,
  type CycleTimeResult,
  type CycleTimeTrendPoint,
  type CycleTimeObservation,
} from '@/lib/api'
import { classifyCycleTime } from '@/lib/cycle-time-bands'
import { useBoardsStore } from '@/store/boards-store'
import { usePeriodFilter } from '@/hooks/use-period-filter'
import { PeriodFilterBar } from '@/components/ui/period-filter-bar'
import { EmptyState } from '@/components/ui/empty-state'
import { NoBoardsConfigured } from '@/components/ui/no-boards-configured'
import { CycleTimePercentileCard } from '@/components/ui/cycle-time-percentile-card'
import { ReopenBanner } from '@/components/ui/reopen-banner'
import { CycleTimeTrendChart } from '@/components/ui/cycle-time-trend-chart'
import { CycleTimeScatter } from '@/components/ui/cycle-time-scatter'
import { CycleTimeBandBadge } from '@/components/ui/cycle-time-band-badge'
import { MetricHelp, type MetricDefinition } from '@/components/ui/metric-help'

const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Metric help definitions
// ---------------------------------------------------------------------------

const CYCLE_TIME_HELP: MetricDefinition[] = [
  {
    name: 'Cycle Time',
    description:
      'Time from first active-work transition (In Progress, In Review, QA, etc.) to Done. Pre-work queue time is excluded. Consecutive in-progress sub-statuses are treated as one continuous cycle — the clock does not restart on status changes within active work. Weekends are excluded by default — values are in working days. Epics and Sub-tasks are not included.',
  },
  {
    name: 'P50 (Median)',
    description: 'The midpoint — half of issues were completed faster than this value. Calculated using linear interpolation.',
  },
  {
    name: 'P75',
    description: '75% of issues were completed within this time. A more conservative planning target than P50.',
  },
  {
    name: 'P85',
    description: '85% of issues were completed within this time.',
  },
  {
    name: 'P95',
    description: 'Only 5% of issues took longer than this. Useful for identifying outliers and worst-case scenarios.',
  },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'pending' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      results: CycleTimeResult[]
      trend: CycleTimeTrendPoint[]
    }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pooledPercentiles(results: CycleTimeResult[]) {
  const allObs = results.flatMap((r) => r.observations)
  const reopenedIssueCount = results.reduce(
    (s, r) => s + r.reopenedIssueCount,
    0,
  )
  const anomalyCount = results.reduce((s, r) => s + r.anomalyCount, 0)
  if (allObs.length === 0) {
    // Proposal 0054 AC E: no completed cycles → null percentiles, not zero
    // (zero would mis-band as 'excellent').
    return {
      p50: null,
      p75: null,
      p85: null,
      p95: null,
      count: 0,
      anomalyCount,
      reopenedIssueCount,
    }
  }
  const sorted = allObs.map((o) => o.cycleTimeDays).sort((a, b) => a - b)
  const pct = (p: number): number => {
    const idx = (p / 100) * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return sorted[lo] + (idx - lo) * ((sorted[hi] ?? 0) - (sorted[lo] ?? 0))
  }
  return {
    p50: Math.round(pct(50) * 10) / 10,
    p75: Math.round(pct(75) * 10) / 10,
    p85: Math.round(pct(85) * 10) / 10,
    p95: Math.round(pct(95) * 10) / 10,
    count: sorted.length,
    anomalyCount,
    reopenedIssueCount,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CycleTimePage() {
  return (
    <Suspense>
      <CycleTimePageInner />
    </Suspense>
  )
}

function CycleTimePageInner() {
  // Board catalogue from store
  const allBoards = useBoardsStore((s) => s.allBoards)
  const kanbanBoardIds = useBoardsStore((s) => s.kanbanBoardIds)
  const boardsStatus = useBoardsStore((s) => s.status)

  // Unified reporting-period filter (shared with DORA) — URL-backed.
  const filter = usePeriodFilter()
  const {
    board,
    isAllBoards,
    mode,
    quarter,
    sprintId,
    window: periodWindow,
    sprintAvailable,
  } = filter

  const [pageState, setPageState] = useState<PageState>({ status: 'idle' })
  const [retryKey, setRetryKey] = useState(0)
  const [excludeWeekends, setExcludeWeekends] = useState(true)

  const reload = useCallback(() => {
    setRetryKey((k) => k + 1)
  }, [])
  const [tablePage, setTablePage] = useState(0)

  // The cycle-time endpoint requires a boardId path segment. For "All boards"
  // send the comma-joined list (backend routes multi-board to the org snapshot).
  const boardIdForPath = isAllBoards ? allBoards.join(',') : board

  // Fetch app config (timezone, excludeWeekends) once on mount
  useEffect(() => {
    getAppConfig()
      .then((cfg) => setExcludeWeekends(cfg.excludeWeekends))
      .catch(() => { /* keep default */ })
  }, [])

  // Auto-reset to Time period when sprint mode becomes unavailable.
  useEffect(() => {
    if (boardsStatus !== 'ready') return
    if (mode === 'sprint' && !sprintAvailable) {
      filter.setMode('timeperiod')
    }
  }, [boardsStatus, sprintAvailable, mode, filter])

  // Main data fetch — fires on filter change or retry
  useEffect(() => {
    let cancelled = false
    if (boardsStatus !== 'ready' || allBoards.length === 0) return
    if (mode === 'quarter' && !quarter) return
    if (mode === 'sprint' && !sprintId) {
      setPageState({ status: 'idle' })
      return
    }
    setPageState({ status: 'loading' })

    const run = async (): Promise<void> => {
      try {
        const [results, trend] = await Promise.all([
          getCycleTime({
            boardId: boardIdForPath,
            ...(mode === 'quarter' && quarter ? { quarter } : {}),
            ...(mode === 'sprint' && sprintId ? { sprintId } : {}),
            ...(mode === 'timeperiod' ? { window: periodWindow } : {}),
          }),
          getCycleTimeTrend({
            boardId: isAllBoards ? undefined : board,
            ...(mode === 'sprint'
              ? { mode: 'sprints' as const, limit: 8 }
              : mode === 'timeperiod'
                ? { mode: 'timeperiod' as const, window: periodWindow }
                : { mode: 'quarters' as const, limit: 8 }),
          }),
        ])
        if (!cancelled) {
          setPageState({ status: 'ready', results, trend })
        }
      } catch (err: unknown) {
        if (!cancelled) {
          if (err instanceof SnapshotPendingError) {
            setPageState({ status: 'pending' })
          } else {
            setPageState({
              status: 'error',
              message: err instanceof Error ? err.message : 'Failed to load cycle time data',
            })
          }
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [board, boardIdForPath, isAllBoards, mode, quarter, sprintId, periodWindow, boardsStatus, allBoards.length, retryKey])

  // Compute pooled percentiles across all boards' results
  const pooled = useMemo(() => {
    if (pageState.status !== 'ready') return null
    return pooledPercentiles(pageState.results)
  }, [pageState])

  // All observations pooled across boards (for scatter + table)
  const allObservations = useMemo((): CycleTimeObservation[] => {
    if (pageState.status !== 'ready') return []
    return pageState.results.flatMap((r) => r.observations)
  }, [pageState])

  // Reset table page when observations change
  useEffect(() => {
    setTablePage(0)
  }, [allObservations])

  // Paginated observations
  const pagedObservations = useMemo(
    () => allObservations.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE),
    [allObservations, tablePage],
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          Cycle Time
          <MetricHelp metrics={CYCLE_TIME_HELP} />
        </h1>
        <p className="mt-1 text-sm text-muted">
          Time from work started to done — excluding pre-work queue
        </p>
      </div>

      {/* No boards configured */}
      {boardsStatus === 'ready' && allBoards.length === 0 && (
        <NoBoardsConfigured />
      )}

      {/* Filters */}
      <PeriodFilterBar
        allBoards={allBoards}
        kanbanBoardIds={kanbanBoardIds}
        board={board}
        isAllBoards={isAllBoards}
        mode={mode}
        quarter={quarter}
        sprintId={sprintId}
        window={periodWindow}
        sprintAvailable={sprintAvailable}
        onBoardChange={filter.setBoard}
        onModeChange={filter.setMode}
        onQuarterChange={filter.setQuarter}
        onSprintChange={filter.setSprintId}
        onWindowChange={filter.setWindow}
      />

      {/* Skeleton loading */}
      {pageState.status === 'loading' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-surface-alt" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[200px] animate-pulse rounded-xl bg-surface-alt" />
            ))}
          </div>
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="h-8 animate-pulse rounded bg-surface-alt" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-surface-alt opacity-70" />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {pageState.status === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{pageState.message}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-2 text-sm font-medium text-red-700 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {pageState.status === 'idle' && (
        <EmptyState
          title="No data"
          message="Select a board and period to view cycle time metrics."
        />
      )}

      {/* Snapshot pending */}
      {pageState.status === 'pending' && (
        <EmptyState
          title="Snapshot not ready"
          message="Time-period metrics are being computed. Trigger a sync or try again shortly."
        />
      )}

      {/* Main content */}
      {pageState.status === 'ready' && pooled && (
        <>
          {/* Anomaly banner */}
          {pooled.anomalyCount > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-sm text-amber-700">
                <span className="font-semibold">
                  {pooled.anomalyCount} issue{pooled.anomalyCount !== 1 ? 's' : ''} excluded
                </span>{' '}
                — no &quot;In Progress&quot; transition found; these issues are omitted from
                percentile calculations.
              </p>
            </div>
          )}

          {/* Reopen banner (proposal 0054 AC F) */}
          <ReopenBanner count={pooled.reopenedIssueCount} />

          {/* No data state for period */}
          {pooled.count === 0 && (
            <EmptyState
              title="No completed issues"
              message={`No issues completed in the selected period for ${isAllBoards ? 'all boards' : board}.`}
            />
          )}

          {pooled.count > 0 && (
            <>
              {/* Percentile summary cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <CycleTimePercentileCard
                  percentile="p50"
                  days={pooled.p50}
                  sampleSize={pooled.count}
                  band={classifyCycleTime(pooled.p50)}
                  excludeWeekends={excludeWeekends}
                />
                <CycleTimePercentileCard
                  percentile="p75"
                  days={pooled.p75}
                  sampleSize={pooled.count}
                  band={classifyCycleTime(pooled.p75)}
                  excludeWeekends={excludeWeekends}
                />
                <CycleTimePercentileCard
                  percentile="p85"
                  days={pooled.p85}
                  sampleSize={pooled.count}
                  band={classifyCycleTime(pooled.p85)}
                  excludeWeekends={excludeWeekends}
                />
                <CycleTimePercentileCard
                  percentile="p95"
                  days={pooled.p95}
                  sampleSize={pooled.count}
                  band={classifyCycleTime(pooled.p95)}
                  excludeWeekends={excludeWeekends}
                />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CycleTimeScatter observations={allObservations} />
                <CycleTimeTrendChart data={pageState.trend} />
              </div>

              {/* Per-issue table */}
              <div className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Issues ({allObservations.length})
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-table-header-bg">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                          Issue
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                          Summary
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                          Type
                        </th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted">
                          Cycle (d)
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                          Completed
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                          Band
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pagedObservations.map((obs) => (
                        <tr
                          key={obs.issueKey}
                          className="hover:bg-interactive-hover-bg"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs">
                            {obs.jiraUrl ? (
                              <a
                                href={obs.jiraUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {obs.issueKey}
                              </a>
                            ) : (
                              <span className="text-blue-600">{obs.issueKey}</span>
                            )}
                          </td>
                          <td className="max-w-xs truncate px-4 py-2.5 text-foreground">
                            {obs.summary}
                          </td>
                          <td className="px-4 py-2.5 text-muted">{obs.issueType}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-foreground">
                            {obs.cycleTimeDays.toFixed(1)}
                          </td>
                          <td className="px-4 py-2.5 text-muted">
                            {new Date(obs.completedAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-2.5">
                            <CycleTimeBandBadge
                              band={classifyCycleTime(obs.cycleTimeDays)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {allObservations.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between border-t border-border px-4 py-3">
                    <p className="text-xs text-muted">
                      Showing {tablePage * PAGE_SIZE + 1}–{Math.min((tablePage + 1) * PAGE_SIZE, allObservations.length)} of {allObservations.length}
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setTablePage((p) => p - 1)}
                        disabled={tablePage === 0}
                        className="rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-interactive-hover-bg disabled:opacity-50"
                      >
                        ← Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setTablePage((p) => p + 1)}
                        disabled={(tablePage + 1) * PAGE_SIZE >= allObservations.length}
                        className="rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-interactive-hover-bg disabled:opacity-50"
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
