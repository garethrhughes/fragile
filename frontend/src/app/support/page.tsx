'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useReplaceParams } from '@/hooks/use-page-params'
import {
  getSupportTickets,
  getSupportSummary,
  getQuarters,
  getSprints,
  type SupportResult,
  type SupportSummary,
  type QuarterInfo,
  type SprintInfo,
} from '@/lib/api'
import { classifyCycleTime } from '@/lib/cycle-time-bands'
import { useBoardsStore } from '@/store/boards-store'
import { BoardChip } from '@/components/ui/board-chip'
import { ToggleChip } from '@/components/ui/toggle-chip'
import { EmptyState } from '@/components/ui/empty-state'
import { NoBoardsConfigured } from '@/components/ui/no-boards-configured'
import { CycleTimeBandBadge } from '@/components/ui/cycle-time-band-badge'
import { SupportDistributionChart } from '@/components/ui/support-distribution-chart'
import { SupportPercentageStat } from '@/components/ui/support-percentage-stat'
import { MetricHelp, type MetricDefinition } from '@/components/ui/metric-help'

const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Metric help definitions
// ---------------------------------------------------------------------------

const SUPPORT_HELP: MetricDefinition[] = [
  {
    name: 'Support Load',
    description:
      'Percentage of issues in the period classified as support work. Issues are matched by epic, label, or issue link type pointing to a triage board — configured per board in Settings. For sprint or current-quarter periods the denominator includes all active issues; for past quarters only issues with a completion in the period are counted.',
  },
  {
    name: 'Cycle Time (support)',
    description:
      'Time from first active-work transition (In Progress or equivalent) to Done for support issues only. Consecutive in-progress sub-statuses are treated as one continuous cycle. Working days, weekends excluded. Epics and Sub-tasks not included.',
  },
  {
    name: 'P50 / P95',
    description:
      'P50 is the median support cycle time; P95 is the 95th percentile (only 5% of support issues took longer). Both use linear interpolation across sorted observations.',
  },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PeriodMode = 'quarter' | 'sprint'

type PageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; results: SupportResult[]; summary: SupportSummary }

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SupportPage() {
  return (
    <Suspense>
      <SupportPageInner />
    </Suspense>
  )
}

function SupportPageInner() {
  const searchParams = useSearchParams()
  const replaceParams = useReplaceParams()

  const allBoards = useBoardsStore((s) => s.allBoards)
  const kanbanBoardIds = useBoardsStore((s) => s.kanbanBoardIds)
  const boardsStatus = useBoardsStore((s) => s.status)

  const boardsParam = searchParams.get('boards')
  const selectedBoards = useMemo<string[]>(
    () => (boardsParam ? boardsParam.split(',').filter(Boolean) : allBoards),
    [boardsParam, allBoards],
  )

  const periodMode = (searchParams.get('mode') ?? 'quarter') as PeriodMode
  const selectedQuarter = searchParams.get('quarter') ?? ''
  const selectedSprintId = searchParams.get('sprintId') ?? ''

  const [quarters, setQuarters] = useState<QuarterInfo[]>([])
  const [sprints, setSprints] = useState<SprintInfo[]>([])
  const [pageState, setPageState] = useState<PageState>({ status: 'idle' })
  const [retryKey, setRetryKey] = useState(0)
  const [tablePage, setTablePage] = useState(0)

  const reload = useCallback(() => setRetryKey((k) => k + 1), [])

  // Sprint mode is only valid when exactly 1 non-Kanban board is selected.
  const sprintModeAvailable = useMemo(
    () =>
      boardsStatus === 'ready' &&
      selectedBoards.length === 1 &&
      !kanbanBoardIds.has(selectedBoards[0] ?? ''),
    [selectedBoards, kanbanBoardIds, boardsStatus],
  )

  // Auto-reset to quarter when sprint mode becomes unavailable.
  useEffect(() => {
    if (boardsStatus !== 'ready') return
    if (!sprintModeAvailable && periodMode === 'sprint') {
      replaceParams({ mode: 'quarter' })
    }
  }, [boardsStatus, sprintModeAvailable, periodMode, replaceParams])

  // Load quarters once on mount
  useEffect(() => {
    let cancelled = false
    getQuarters()
      .then((res) => {
        if (!cancelled) {
          setQuarters(res)
          if (res.length > 0 && !searchParams.get('quarter') && periodMode !== 'sprint') {
            replaceParams({ quarter: res[0].quarter })
          }
        }
      })
      .catch(() => { /* leave empty */ })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load sprints when a single board is selected in sprint mode.
  // Filter to active/closed only; sort descending (most recent first).
  useEffect(() => {
    if (!sprintModeAvailable || selectedBoards.length !== 1) {
      setSprints([])
      return
    }
    let cancelled = false
    getSprints(selectedBoards[0]!)
      .then((res) => {
        if (!cancelled) {
          const filtered = res
            .filter((s) => s.state === 'active' || s.state === 'closed')
            // API already returns startDate DESC — most recent first; no sort needed
          setSprints(filtered)
          // Auto-select first (most recent) sprint if none in URL
          if (filtered.length > 0 && !searchParams.get('sprintId')) {
            replaceParams({ sprintId: String(filtered[0]!.id) })
          }
        }
      })
      .catch(() => { if (!cancelled) setSprints([]) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprintModeAvailable, selectedBoards[0]])

  // Main data fetch
  useEffect(() => {
    let cancelled = false
    if (boardsStatus !== 'ready') return

    const inSprintMode = periodMode === 'sprint'
    const hasPeriod = inSprintMode ? Boolean(selectedSprintId) : Boolean(selectedQuarter)
    if (!hasPeriod) return

    setPageState({ status: 'loading' })

    const params = {
      boardId: selectedBoards.join(',') || undefined,
      ...(inSprintMode
        ? { sprintId: selectedSprintId }
        : { quarter: selectedQuarter }),
    }

    const run = async (): Promise<void> => {
      try {
        const [results, summary] = await Promise.all([
          getSupportTickets(params),
          getSupportSummary(params),
        ])
        if (!cancelled) {
          setPageState({ status: 'ready', results, summary })
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setPageState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load support data',
          })
        }
      }
    }
    void run()
    return () => { cancelled = true }
  }, [selectedBoards, selectedQuarter, selectedSprintId, periodMode, boardsStatus, retryKey])

  // All tickets across boards for the table
  const allTickets = useMemo(() => {
    if (pageState.status !== 'ready') return []
    return pageState.results.flatMap((r) => r.tickets)
  }, [pageState])

  useEffect(() => { setTablePage(0) }, [allTickets])

  const pagedTickets = useMemo(
    () => allTickets.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE),
    [allTickets, tablePage],
  )

  const handleBoardSelect = useCallback(
    (boardId: string) => replaceParams({ boards: boardId === (selectedBoards[0] ?? '') && selectedBoards.length === 1 ? '' : boardId }),
    [replaceParams, selectedBoards],
  )

  // Human-readable period label for empty states
  const periodLabel = periodMode === 'sprint'
    ? (sprints.find((s) => String(s.id) === selectedSprintId)?.name ?? selectedSprintId)
    : selectedQuarter
  const boardLabel = selectedBoards.length < allBoards.length
    ? ` for board ${selectedBoards.join(', ')}`
    : ''

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          Support
          <MetricHelp metrics={SUPPORT_HELP} />
        </h1>
        <p className="mt-1 text-sm text-muted">
          Support ticket volume and cycle time across engineering boards
        </p>
      </div>

      {boardsStatus === 'ready' && allBoards.length === 0 && <NoBoardsConfigured />}

      {/* Filters */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        {/* Board selector */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">Board</label>
          <div className="flex flex-wrap gap-2">
            {/* All option */}
            <BoardChip
              boardId="All"
              selected={selectedBoards.length === allBoards.length || selectedBoards.length === 0}
              onClick={() => replaceParams({ boards: '' })}
            />
            {/* Individual boards */}
            {allBoards.map((boardId) => (
              <BoardChip
                key={boardId}
                boardId={boardId}
                selected={selectedBoards.length < allBoards.length && selectedBoards.includes(boardId)}
                onClick={() => handleBoardSelect(boardId)}
              />
            ))}
          </div>
        </div>

        {/* Period type toggle */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">Period</label>
          <div className="inline-flex rounded-lg border border-border">
            <button
              type="button"
              onClick={() => replaceParams({ mode: 'quarter' })}
              className={`rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${
                periodMode === 'quarter'
                  ? 'bg-interactive-selected-bg text-interactive-selected-fg'
                  : 'text-muted hover:bg-interactive-hover-bg'
              }`}
            >
              Quarter
            </button>
            <button
              type="button"
              disabled={!sprintModeAvailable}
              onClick={() => {
                if (sprintModeAvailable) replaceParams({ mode: 'sprint' })
              }}
              className={`rounded-r-lg px-4 py-2 text-sm font-medium transition-colors ${
                periodMode === 'sprint'
                  ? 'bg-interactive-selected-bg text-interactive-selected-fg'
                  : !sprintModeAvailable
                    ? 'cursor-not-allowed text-muted opacity-40'
                    : 'text-muted hover:bg-interactive-hover-bg'
              }`}
            >
              Sprint
            </button>
          </div>
          {!sprintModeAvailable && boardsStatus === 'ready' && (
            <p className="mt-1 text-xs text-muted">
              Select a single Scrum board to enable sprint view.
            </p>
          )}
        </div>

        {/* Quarter selector */}
        {periodMode === 'quarter' && (
          <div>
            <label className="mb-2 block text-sm font-medium text-muted">Quarter</label>
            <div className="inline-flex flex-wrap gap-1">
              {quarters.map((q) => (
                <ToggleChip
                  key={q.quarter}
                  label={q.quarter}
                  selected={selectedQuarter === q.quarter}
                  onClick={() => replaceParams({ quarter: q.quarter })}
                />
              ))}
            </div>
          </div>
        )}

        {/* Sprint selector */}
        {periodMode === 'sprint' && sprints.length > 0 && (
          <div>
            <label htmlFor="sprint-select" className="mb-2 block text-sm font-medium text-muted">Sprint</label>
            <select
              id="sprint-select"
              value={selectedSprintId}
              onChange={(e) => replaceParams({ sprintId: e.target.value })}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {sprints.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}{s.state === 'active' ? ' (Active)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Skeleton */}
      {pageState.status === 'loading' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-surface-alt" />
            ))}
          </div>
          <div className="h-[200px] animate-pulse rounded-xl bg-surface-alt" />
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

      {/* Idle */}
      {pageState.status === 'idle' && (
        <EmptyState title="No data" message="Select a period to view support metrics." />
      )}

      {/* Ready */}
      {pageState.status === 'ready' && (
        <>
          {pageState.summary.totalIssues === 0 ? (
            <EmptyState
              title="No completed issues"
              message={`No issues completed in ${periodLabel}${boardLabel}.`}
            />
          ) : (
            <>
              {/* Summary stats row */}
              <div className="grid gap-4 sm:grid-cols-3">
                <SupportPercentageStat
                  percentage={pageState.summary.supportPercentage}
                  supportIssues={pageState.summary.supportIssues}
                  totalIssues={pageState.summary.totalIssues}
                />

                 {/* P50 card */}
                 <div className="rounded-xl border bg-card p-5 shadow-sm border-l-4 border-l-blue-400">
                   <h3 className="text-sm font-medium text-muted">P50 Cycle Time</h3>
                   <div className="mt-3 flex items-end gap-2">
                     <span className="text-3xl font-bold tracking-tight">
                       {pageState.summary.p50Days.toFixed(1)}
                     </span>
                     <span className="mb-1 text-sm text-muted">working days</span>
                   </div>
                   {pageState.summary.p50Days > 0 && (
                     <div className="mt-3">
                       <CycleTimeBandBadge band={classifyCycleTime(pageState.summary.p50Days)} />
                     </div>
                   )}
                   {periodMode === 'sprint' && (
                     <p className="mt-2 text-xs text-muted">Completed tickets only</p>
                   )}
                 </div>

                 {/* P95 card */}
                 <div className="rounded-xl border bg-card p-5 shadow-sm border-l-4 border-l-purple-400">
                   <h3 className="text-sm font-medium text-muted">P95 Cycle Time</h3>
                   <div className="mt-3 flex items-end gap-2">
                     <span className="text-3xl font-bold tracking-tight">
                       {pageState.summary.p95Days.toFixed(1)}
                     </span>
                     <span className="mb-1 text-sm text-muted">working days</span>
                   </div>
                   {pageState.summary.p95Days > 0 && (
                     <div className="mt-3">
                       <CycleTimeBandBadge band={classifyCycleTime(pageState.summary.p95Days)} />
                     </div>
                   )}
                   {periodMode === 'sprint' && (
                     <p className="mt-2 text-xs text-muted">Completed tickets only</p>
                   )}
                 </div>
              </div>

              {/* Distribution chart + per-board breakdown */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Pie chart */}
                <div className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-2 text-sm font-semibold text-foreground">
                    Issue Distribution
                  </h2>
                  <SupportDistributionChart
                    supportIssues={pageState.summary.supportIssues}
                    totalIssues={pageState.summary.totalIssues}
                  />
                </div>

                {/* Per-board breakdown */}
                <div className="rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-foreground">By Board</h2>
                  </div>
                  <div className="divide-y divide-border">
                    {pageState.summary.byBoard.map((b) => (
                      <div key={b.boardId} className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-medium">{b.boardId}</span>
                          <span className="text-xs text-muted">
                            {b.supportIssues} / {b.totalIssues}
                          </span>
                        </div>
                        <span className="text-sm font-semibold">
                          {b.percentage.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Ticket table */}
              {allTickets.length > 0 && (
                <div className="rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-foreground">
                      Support Tickets ({allTickets.length})
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-table-header-bg">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Issue</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Summary</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Board</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Type</th>
                          <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted">Cycle (d)</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Completed</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Band</th>
                          <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Match</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {pagedTickets.map((ticket) => (
                          <tr key={ticket.issueKey} className="hover:bg-interactive-hover-bg">
                            <td className="px-4 py-2.5 font-mono text-xs">
                              {ticket.jiraUrl ? (
                                <a
                                  href={ticket.jiraUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {ticket.issueKey}
                                </a>
                              ) : (
                                <span className="text-blue-600">{ticket.issueKey}</span>
                              )}
                            </td>
                            <td className="max-w-xs truncate px-4 py-2.5 text-foreground">
                              {ticket.summary}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-muted">
                              {ticket.boardId}
                            </td>
                            <td className="px-4 py-2.5 text-muted">{ticket.issueType}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-foreground">
                              {ticket.cycleTimeDays != null
                                ? ticket.cycleTimeDays.toFixed(1)
                                : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-muted">
                              {ticket.completedAt
                                ? new Date(ticket.completedAt).toLocaleDateString()
                                : '—'}
                            </td>
                            <td className="px-4 py-2.5">
                              {ticket.band != null ? (
                                <CycleTimeBandBadge band={ticket.band} />
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize bg-slate-100 text-slate-700 border-slate-200">
                                {ticket.matchReason}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {allTickets.length > PAGE_SIZE && (
                    <div className="flex items-center justify-between border-t border-border px-4 py-3">
                      <p className="text-xs text-muted">
                        Showing {tablePage * PAGE_SIZE + 1}–{Math.min((tablePage + 1) * PAGE_SIZE, allTickets.length)} of {allTickets.length}
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
                          disabled={(tablePage + 1) * PAGE_SIZE >= allTickets.length}
                          className="rounded border border-border px-2 py-1 text-xs transition-colors hover:bg-interactive-hover-bg disabled:opacity-50"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
