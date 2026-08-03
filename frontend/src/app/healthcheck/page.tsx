'use client'

/**
 * Healthcheck — weekly per-board engineering healthcheck (feature 0019, ADR 0070).
 *
 * For a selected ISO week, shows three per-board scores (Stability, Roadmap,
 * Support) computed against a shared denominator, plus a trailing 8-week trend.
 * Replaces the former Pulse report. URL-param driven (?week=YYYY-Www).
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useReplaceParams } from '@/hooks/use-page-params'
import {
  getHealthcheck,
  type HealthcheckResponse,
} from '@/lib/api'
import {
  prevWeek,
  nextWeek,
  formatWeekLabel,
  lastCompletedWeek as lastCompletedWeekFn,
} from '@/lib/iso-week'
import { HealthcheckScoreCard } from '@/components/ui/healthcheck-score-card'
import { HealthcheckTrendChart } from '@/components/ui/healthcheck-trend-chart'
import { HealthcheckTicketsTable } from '@/components/ui/healthcheck-tickets-table'
import { MetricHelp, type MetricDefinition } from '@/components/ui/metric-help'

/**
 * How each Healthcheck metric is calculated (ADR 0070/0071/0073/0074).
 * Shown in the header help popover so the definitions live next to the data.
 */
const HEALTHCHECK_METRICS: MetricDefinition[] = [
  {
    name: 'Denominator — "tickets started this week"',
    description:
      'The shared base for all three scores: every ticket whose first-ever start transition fell in the selected week. Scrum boards use the first transition into an "In Progress" status; kanban boards use the first transition onto the board (falling back to the creation date). Epics and sub-tasks are excluded.',
  },
  {
    name: 'Stability (scrum boards only)',
    description:
      'Of the tickets started this week, the share that were planned — committed at the start of, or carried over into, the sprint that was active when the ticket moved to In Progress. Higher is better. Kanban boards do not contribute.',
    formula: '100 × (planned tickets started) ÷ (tickets started)',
    bands: [
      { label: 'Green', threshold: '≥ 80%' },
      { label: 'Amber', threshold: '60–79%' },
      { label: 'Red', threshold: '< 60%' },
    ],
  },
  {
    name: 'Roadmap (scrum boards only)',
    description:
      'Of the tickets started this week, the share linked to a roadmap idea (via epic or direct link). This is a membership check — it does not require the work to be delivered. Higher is better. Kanban boards do not contribute.',
    formula: '100 × (roadmap-linked tickets started) ÷ (tickets started)',
    bands: [
      { label: 'Green', threshold: '≥ 80%' },
      { label: 'Amber', threshold: '48–79%' },
      { label: 'Red', threshold: '< 48%' },
    ],
  },
  {
    name: 'Support (all boards)',
    description:
      'Of the tickets started this week, the share classified as reactive support work (by support epic, label, or triage-board link). Lower is better — a high figure means a large share of started work was unplanned support.',
    formula: '100 × (support tickets started) ÷ (tickets started)',
    bands: [
      { label: 'Green', threshold: '≤ 20%' },
      { label: 'Amber', threshold: '21–40%' },
      { label: 'Red', threshold: '> 40%' },
    ],
  },
  {
    name: 'Org-wide pooling',
    description:
      'Each score combines all boards by pooling: numerators and denominators are summed across the contributing boards, then the score is computed from those totals (so larger boards weigh proportionally more). A dimension is N/A when no contributing board started any tickets that week.',
  },
  {
    name: 'Trend',
    description:
      'The chart shows the same three org-wide scores over the trailing 8 weeks (oldest to newest, ending at the selected week). Weeks with no applicable tickets appear as gaps.',
  },
]

type PageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: HealthcheckResponse }
  | { status: 'error'; message: string }

function HealthcheckPageInner() {
  const searchParams = useSearchParams()
  const replaceParams = useReplaceParams()

  const defaultWeek = useMemo(() => lastCompletedWeekFn(), [])
  const weekParam = searchParams.get('week') ?? defaultWeek

  const [pageState, setPageState] = useState<PageState>({ status: 'idle' })
  const [retryKey, setRetryKey] = useState(0)
  const reload = useCallback(() => setRetryKey((k) => k + 1), [])

  useEffect(() => {
    if (!searchParams.get('week')) {
      replaceParams({ week: defaultWeek })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!weekParam.match(/^\d{4}-W\d{2}$/)) return

    let cancelled = false
    setPageState({ status: 'loading' })

    getHealthcheck(weekParam)
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

    return () => {
      cancelled = true
    }
  }, [weekParam, retryKey])

  const isLatestWeek = weekParam === defaultWeek

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Healthcheck</h1>
          <MetricHelp metrics={HEALTHCHECK_METRICS} />
        </div>
        <p className="mt-1 text-sm text-muted">
          Weekly engineering healthcheck — across all boards, of the work started this
          week, how much was planned, on the roadmap, and reactive support.
        </p>
      </div>

      {/* Week nav */}
      <div className="flex items-center gap-1.5">
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
          disabled={isLatestWeek}
          className="rounded border border-border px-2 py-1 text-sm hover:bg-interactive-hover-bg disabled:opacity-40"
          aria-label="Next week"
        >
          →
        </button>
        {!isLatestWeek && (
          <button
            type="button"
            onClick={() => replaceParams({ week: defaultWeek })}
            className="ml-1 rounded border border-border px-2 py-1 text-xs text-muted hover:bg-interactive-hover-bg"
          >
            Latest
          </button>
        )}
      </div>

      {/* Body */}
      {pageState.status === 'loading' && (
        <p className="text-sm text-muted">Loading…</p>
      )}

      {pageState.status === 'error' && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">
          <p className="text-red-700 dark:text-red-300">{pageState.message}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-2 rounded border border-border px-3 py-1 text-xs hover:bg-interactive-hover-bg"
          >
            Retry
          </button>
        </div>
      )}

      {pageState.status === 'ready' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HealthcheckScoreCard label="Stability" dimension={pageState.data.stability} />
            <HealthcheckScoreCard label="Roadmap" dimension={pageState.data.roadmap} />
            <HealthcheckScoreCard label="Support" dimension={pageState.data.support} lowerIsBetter />
          </div>
          <HealthcheckTrendChart trend={pageState.data.trend} />
          <HealthcheckTicketsTable tickets={pageState.data.tickets} />
        </div>
      )}
    </div>
  )
}

export default function HealthcheckPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <HealthcheckPageInner />
    </Suspense>
  )
}
