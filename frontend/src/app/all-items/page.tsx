'use client'

/**
 * Pulse — bespoke MyPass weekly cross-board activity report.
 * Feature 0012 / Proposal 0062. Not for upstreaming.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useReplaceParams } from '@/hooks/use-page-params'
import {
  getAllItems,
  type AllItemsResponse,
  type AllItemsFilter,
  type AllItemsBoardResult,
  type AllItemsIssue,
} from '@/lib/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns current ISO week as YYYY-Www */
function currentIsoWeek(): string {
  const now = new Date()
  const jan4 = new Date(Date.UTC(now.getUTCFullYear(), 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))

  const dayOfWeek = now.getUTCDay() === 0 ? 7 : now.getUTCDay()
  const thisWeekMon = new Date(now)
  thisWeekMon.setUTCDate(now.getUTCDate() - (dayOfWeek - 1))
  thisWeekMon.setUTCHours(0, 0, 0, 0)

  const diff = thisWeekMon.getTime() - week1Mon.getTime()
  const weekNum = Math.round(diff / (7 * 86400000)) + 1

  return `${now.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

/** Formats YYYY-Www as "W20 '26" */
function formatWeekLabel(week: string): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return week
  return `W${m[2]} '${m[1].slice(2)}`
}

function prevWeek(week: string): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return week
  const year = parseInt(m[1], 10)
  const num = parseInt(m[2], 10)
  if (num > 1) return `${year}-W${String(num - 1).padStart(2, '0')}`
  return `${year - 1}-W52`
}

function nextWeek(week: string): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return week
  const year = parseInt(m[1], 10)
  const num = parseInt(m[2], 10)
  if (num < 52) return `${year}-W${String(num + 1).padStart(2, '0')}`
  return `${year + 1}-W01`
}

type PageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AllItemsResponse }

const ALL_FILTERS: { key: AllItemsFilter; label: string }[] = [
  { key: 'added-mid-sprint', label: 'Added mid-sprint' },
  { key: 'not-on-roadmap', label: 'Not on roadmap' },
  { key: 'support', label: 'Support' },
  { key: 'ttb-support', label: 'TTB support' },
]

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  return (
    <span
      ref={ref}
      className="relative inline-flex cursor-help"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-foreground shadow-lg">
          {text}
          {/* Arrow */}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-border" />
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Health score badge
// ---------------------------------------------------------------------------

function HealthBadge({ score, large = false }: { score: number; large?: boolean }) {
  const colour =
    score >= 80
      ? 'bg-green-100 text-green-800 border-green-200'
      : score >= 60
        ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
        : 'bg-red-100 text-red-800 border-red-200'
  return (
    <span className={`inline-flex items-center rounded-full border font-semibold ${large ? 'px-4 py-1 text-2xl' : 'px-2.5 py-0.5 text-sm'} ${colour}`}>
      {score}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Board result card
// ---------------------------------------------------------------------------

function BoardCard({ board }: { board: AllItemsBoardResult }) {
  const [expanded, setExpanded] = useState(false)
  const { summary, healthScore } = board

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-foreground">{board.boardId}</span>
          <span className="rounded-full border border-border bg-surface-alt px-2 py-0.5 text-xs text-muted">
            {board.boardType}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Tooltip text="Overall health score: average of Roadmap alignment and Stability. Higher is better. Support burden is shown separately but does not affect this score.">
            <span className="text-xs text-muted underline decoration-dotted">Health</span>
          </Tooltip>
          <HealthBadge score={healthScore.overall} />
        </div>
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border sm:grid-cols-6">
        {[
          { label: 'Total', value: summary.totalItems },
          { label: 'Started', value: summary.startedCount },
          { label: 'Added', value: summary.addedMidSprintCount },
          { label: 'Completed', value: summary.completedCount },
          { label: 'On roadmap', value: summary.onRoadmapCount },
          { label: 'Support', value: summary.supportCount },
        ].map(({ label, value }) => (
          <div key={label} className="px-3 py-2 text-center">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>

      {/* Health score breakdown — roadmap + stability only */}
      <div className="grid grid-cols-2 divide-x divide-border border-b border-border text-xs">
        <div className="px-3 py-2 text-center">
          <Tooltip text="Roadmap alignment: percentage of completed items that were delivered on or before their roadmap idea's target date. 100% when nothing was completed this week.">
            <span className="font-medium underline decoration-dotted">
              {healthScore.roadmapAlignmentScore}%
            </span>
          </Tooltip>
          <div className="mt-0.5 text-muted">Roadmap</div>
        </div>
        <div className="px-3 py-2 text-center">
          <Tooltip text="Stability: percentage of sprint items that were committed at sprint start (not added mid-sprint). 100% when no items were added mid-sprint.">
            <span className="font-medium underline decoration-dotted">
              {healthScore.stabilityScore}%
            </span>
          </Tooltip>
          <div className="mt-0.5 text-muted">Stability</div>
        </div>
      </div>

      {/* Expand/collapse items */}
      {board.items.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="w-full px-4 py-2 text-left text-xs font-medium text-muted hover:bg-interactive-hover-bg"
          >
            {expanded ? '▾ Hide items' : `▸ Show ${board.items.length} item${board.items.length === 1 ? '' : 's'}`}
          </button>

          {expanded && (
            <div className="overflow-x-auto">
              <IssueTable items={board.items} />
            </div>
          )}
        </>
      )}

      {board.items.length === 0 && (
        <div className="px-4 py-3 text-xs text-muted italic">No items matching current filters.</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Issue table
// ---------------------------------------------------------------------------

function IssueTable({ items }: { items: AllItemsIssue[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-table-header-bg">
          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Issue</th>
          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Summary</th>
          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Type</th>
          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Status</th>
          <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">Sprint</th>
          <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">Flags</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {items.map((item) => (
          <tr key={item.key} className="hover:bg-interactive-hover-bg">
            <td className="px-3 py-2 font-mono text-xs">
              {item.jiraUrl ? (
                <a href={item.jiraUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {item.key}
                </a>
              ) : (
                <span className="text-blue-600">{item.key}</span>
              )}
            </td>
            <td className="max-w-xs truncate px-3 py-2 text-foreground">{item.summary}</td>
            <td className="px-3 py-2 text-xs text-muted">{item.issueType}</td>
            <td className="px-3 py-2 text-xs text-muted">{item.status}</td>
            <td className="px-3 py-2 text-xs text-muted">{item.sprintName ?? '—'}</td>
            <td className="px-3 py-2">
              <div className="flex flex-wrap justify-center gap-1">
                {item.started && <FlagBadge label="started" colour="blue" />}
                {item.completed && <FlagBadge label="done" colour="green" />}
                {item.addedMidSprint && <FlagBadge label="mid-sprint" colour="orange" />}
                {item.kanbanAdd && <FlagBadge label="kanban add" colour="orange" />}
                {item.onRoadmap && <FlagBadge label="roadmap" colour="green" />}
                {item.isTtbSupport && <FlagBadge label="TTB" colour="red" />}
                {item.isSupport && !item.isTtbSupport && <FlagBadge label="support" colour="red" />}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FlagBadge({ label, colour }: { label: string; colour: 'blue' | 'green' | 'orange' | 'red' }) {
  const colours = {
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    green: 'bg-green-100 text-green-700 border-green-200',
    orange: 'bg-orange-100 text-orange-700 border-orange-200',
    red: 'bg-red-100 text-red-700 border-red-200',
  }
  return (
    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-xs font-medium ${colours[colour]}`}>
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AllItemsPage() {
  return (
    <Suspense>
      <AllItemsPageInner />
    </Suspense>
  )
}

function AllItemsPageInner() {
  const searchParams = useSearchParams()
  const replaceParams = useReplaceParams()

  const thisWeek = useMemo(() => currentIsoWeek(), [])

  const weekParam = searchParams.get('week') ?? thisWeek
  const filterParam = searchParams.get('filter') ?? ''
  const activeFilters = useMemo<AllItemsFilter[]>(
    () => filterParam.split('|').filter((f): f is AllItemsFilter =>
      ['added-mid-sprint', 'not-on-roadmap', 'support', 'ttb-support'].includes(f)
    ),
    [filterParam],
  )

  const [pageState, setPageState] = useState<PageState>({ status: 'idle' })
  const [retryKey, setRetryKey] = useState(0)
  const reload = useCallback(() => setRetryKey((k) => k + 1), [])

  useEffect(() => {
    if (!searchParams.get('week')) {
      replaceParams({ week: thisWeek })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!weekParam.match(/^\d{4}-W\d{2}$/)) return

    let cancelled = false
    setPageState({ status: 'loading' })

    getAllItems(weekParam, activeFilters.length > 0 ? activeFilters : undefined)
      .then((data) => {
        if (!cancelled) setPageState({ status: 'ready', data })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPageState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to load data',
          })
        }
      })

    return () => { cancelled = true }
  }, [weekParam, filterParam, retryKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFilter = useCallback(
    (key: AllItemsFilter) => {
      const next = activeFilters.includes(key)
        ? activeFilters.filter((f) => f !== key)
        : [...activeFilters, key]
      replaceParams({ filter: next.join('|') || '' })
    },
    [activeFilters, replaceParams],
  )

  const isCurrentWeek = weekParam === thisWeek

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Pulse</h1>
        <p className="mt-1 text-sm text-muted">
          Weekly cross-board activity — started, added, completed, and roadmap alignment
        </p>
      </div>

      {/* Controls */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        {/* Week picker */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">Week</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => replaceParams({ week: prevWeek(weekParam) })}
              className="rounded border border-border px-2 py-1 text-sm hover:bg-interactive-hover-bg"
              aria-label="Previous week"
            >
              ←
            </button>
            <span className="min-w-[80px] text-center font-mono text-sm font-semibold">
              {formatWeekLabel(weekParam)}
            </span>
            <button
              type="button"
              onClick={() => replaceParams({ week: nextWeek(weekParam) })}
              disabled={isCurrentWeek}
              className="rounded border border-border px-2 py-1 text-sm hover:bg-interactive-hover-bg disabled:opacity-40"
              aria-label="Next week"
            >
              →
            </button>
            {!isCurrentWeek && (
              <button
                type="button"
                onClick={() => replaceParams({ week: currentIsoWeek() })}
                className="ml-2 rounded border border-border px-2 py-1 text-xs text-muted hover:bg-interactive-hover-bg"
              >
                Current week
              </button>
            )}
          </div>
        </div>

        {/* Filter chips */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">Filter</label>
          <div className="flex flex-wrap gap-2">
            {ALL_FILTERS.map(({ key, label }) => {
              const active = activeFilters.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleFilter(key)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-100 text-blue-700'
                      : 'border-border bg-surface-alt text-muted hover:bg-interactive-hover-bg'
                  }`}
                >
                  {label}
                </button>
              )
            })}
            {activeFilters.length > 0 && (
              <button
                type="button"
                onClick={() => replaceParams({ filter: '' })}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-interactive-hover-bg"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Loading */}
      {pageState.status === 'loading' && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-surface-alt" />
          ))}
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

      {/* Ready */}
      {pageState.status === 'ready' && (
        <>
          {/* Overall score + totals bar */}
          <div className="flex items-stretch gap-3">
            {/* Overall score */}
            <Tooltip text="Average health score across all boards for this week. Calculated as the mean of each board's health score, which is the average of Roadmap alignment % and Stability %.">
              <div className="flex min-w-[120px] cursor-help flex-col items-center justify-center rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Overall</div>
                <div className="mt-1">
                  <HealthBadge score={pageState.data.overallScore} large />
                </div>
                <div className="mt-1 text-xs text-muted">avg health</div>
              </div>
            </Tooltip>

            {/* Count totals */}
            <div className="grid flex-1 grid-cols-3 gap-3 sm:grid-cols-7">
              {[
                { label: 'Total items', value: pageState.data.totals.totalItems },
                { label: 'Started', value: pageState.data.totals.startedCount },
                { label: 'Added mid-sprint', value: pageState.data.totals.addedMidSprintCount },
                { label: 'Completed', value: pageState.data.totals.completedCount },
                { label: 'On roadmap', value: pageState.data.totals.onRoadmapCount },
                { label: 'Support', value: pageState.data.totals.supportCount },
                { label: 'TTB support', value: pageState.data.totals.ttbSupportCount },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-border bg-card p-3 text-center shadow-sm">
                  <div className="text-2xl font-bold">{value}</div>
                  <div className="mt-0.5 text-xs text-muted">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-board cards */}
          {pageState.data.boards.length === 0 ? (
            <div className="rounded-xl border border-border bg-card px-6 py-10 text-center text-muted">
              No boards configured.
            </div>
          ) : (
            <div className="space-y-4">
              {pageState.data.boards.map((board) => (
                <BoardCard key={board.boardId} board={board} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
