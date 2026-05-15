'use client'

/**
 * Pulse — bespoke MyPass weekly cross-board activity report.
 * Feature 0012 / Proposal 0069 (density redesign). Not for upstreaming.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useReplaceParams } from '@/hooks/use-page-params'
import {
  getAllItems,
  type AllItemsResponse,
  type AllItemsFilter,
} from '@/lib/api'
import { TotalsStrip, BoardTable } from './pulse-components'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateToIsoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + (4 - dow))
  const isoYear = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const weekNum = Math.round((thursday.getTime() - week1Mon.getTime()) / (7 * 86_400_000)) + 1
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`
}

function currentIsoWeek(): string {
  return dateToIsoWeekKey(new Date())
}

function isoWeekToMonday(week: string): Date | null {
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return null
  const isoYear = parseInt(m[1], 10)
  const weekNum = parseInt(m[2], 10)
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const jan4Dow = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay()
  const week1Mon = new Date(jan4)
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1))
  const monday = new Date(week1Mon)
  monday.setUTCDate(week1Mon.getUTCDate() + (weekNum - 1) * 7)
  return monday
}

function formatWeekLabel(week: string): string {
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return week
  return `W${m[2]} '${m[1].slice(2)}`
}

function prevWeek(week: string): string {
  const monday = isoWeekToMonday(week)
  if (!monday) return week
  monday.setUTCDate(monday.getUTCDate() - 7)
  return dateToIsoWeekKey(monday)
}

function nextWeek(week: string): string {
  const monday = isoWeekToMonday(week)
  if (!monday) return week
  monday.setUTCDate(monday.getUTCDate() + 7)
  return dateToIsoWeekKey(monday)
}

type PageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: AllItemsResponse }

const ALL_FILTERS: { key: AllItemsFilter; label: string }[] = [
  { key: 'added-mid-sprint', label: 'Added mid-week / mid-sprint' },
  { key: 'not-on-roadmap', label: 'Not on roadmap' },
  { key: 'support', label: 'Support' },
  { key: 'ttb-support', label: 'TTB support' },
]

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
    <div className="space-y-3">
      {/* ------------------------------------------------------------------ */}
      {/* Title + compact toolbar (single row)                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold leading-none">
          Pulse
          <span className="ml-1.5 text-xs font-normal text-muted">(beta)</span>
        </h1>

        {/* Week nav */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => replaceParams({ week: prevWeek(weekParam) })}
            className="rounded border border-border px-1.5 py-0.5 text-sm hover:bg-interactive-hover-bg"
            aria-label="Previous week"
          >
            ←
          </button>
          <span className="min-w-[72px] text-center font-mono text-sm font-semibold">
            {formatWeekLabel(weekParam)}
          </span>
          <button
            type="button"
            onClick={() => replaceParams({ week: nextWeek(weekParam) })}
            disabled={isCurrentWeek}
            className="rounded border border-border px-1.5 py-0.5 text-sm hover:bg-interactive-hover-bg disabled:opacity-40"
            aria-label="Next week"
          >
            →
          </button>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={() => replaceParams({ week: currentIsoWeek() })}
              className="ml-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted hover:bg-interactive-hover-bg"
            >
              Now
            </button>
          )}
        </div>

        {/* Divider */}
        <span className="hidden text-border sm:inline">|</span>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_FILTERS.map(({ key, label }) => {
            const active = activeFilters.includes(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFilter(key)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-100 text-blue-700'
                    : 'border-border bg-surface-alt text-muted hover:bg-interactive-hover-bg'
                }`}
              >
                {label}
                {active && ' ×'}
              </button>
            )
          })}
          {activeFilters.length > 0 && (
            <button
              type="button"
              onClick={() => replaceParams({ filter: '' })}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:bg-interactive-hover-bg"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Loading                                                             */}
      {/* ------------------------------------------------------------------ */}
      {pageState.status === 'loading' && (
        <div className="space-y-1.5">
          <div className="h-8 animate-pulse rounded-lg bg-surface-alt" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-surface-alt" />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Error                                                               */}
      {/* ------------------------------------------------------------------ */}
      {pageState.status === 'error' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-600">{pageState.message}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-1.5 text-sm font-medium text-red-700 underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Ready                                                               */}
      {/* ------------------------------------------------------------------ */}
      {pageState.status === 'ready' && (
        <>
          <TotalsStrip
            totals={pageState.data.totals}
            overallScore={pageState.data.overallScore}
          />
          <BoardTable boards={pageState.data.boards} />
        </>
      )}
    </div>
  )
}
