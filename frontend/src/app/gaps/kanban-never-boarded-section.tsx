'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Info } from 'lucide-react'
import {
  getKanbanNeverBoarded,
  ApiError,
  type UnplannedDoneIssue,
  type UnplannedDoneResponse,
} from '@/lib/api'
import { useBoardsStore } from '@/store/boards-store'
import { QuarterSelect } from '@/components/ui/quarter-select'
import { DataTable, type Column } from '@/components/ui/data-table'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PeriodMode = 'last90' | 'quarter'

// ---------------------------------------------------------------------------
// StatChip — mirrors the sprint-detail page pattern exactly
// ---------------------------------------------------------------------------

interface StatChipProps {
  label: string
  value: string | number
}

function StatChip({ label, value }: StatChipProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-4 py-3 text-center">
      <span className="text-xl font-bold">{value}</span>
      <span className="mt-0.5 text-xs text-muted">{label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Date formatting helper — dd Mon yyyy
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Table column definitions
// ---------------------------------------------------------------------------

function buildColumns(): Column<UnplannedDoneIssue>[] {
  return [
    {
      key: 'key',
      label: 'Issue',
      sortable: true,
      render: (value, row) => {
        const key = String(value)
        if (row.jiraUrl) {
          return (
            <a
              href={row.jiraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-sm font-medium text-blue-600 hover:underline"
            >
              {key}
              <ExternalLink className="h-3 w-3" />
            </a>
          )
        }
        return <span className="font-mono text-sm">{key}</span>
      },
    },
    {
      key: 'summary',
      label: 'Summary',
      sortable: true,
      render: (value) => {
        const text = String(value)
        const truncated = text.length > 60 ? text.slice(0, 60) + '…' : text
        return (
          <span title={text} className="block max-w-xs truncate text-sm">
            {truncated}
          </span>
        )
      },
    },
    {
      key: 'issueType',
      label: 'Type',
      sortable: true,
    },
    {
      key: 'boardId',
      label: 'Board',
      sortable: true,
    },
    {
      key: 'resolvedStatus',
      label: 'Resolved Status',
      sortable: true,
      render: (value) => (
        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
          {String(value)}
        </span>
      ),
    },
    {
      key: 'resolvedAt',
      label: 'Resolved',
      sortable: true,
      render: (value) => (
        <span className="whitespace-nowrap text-sm">{formatDate(String(value))}</span>
      ),
    },
    {
      key: 'points',
      label: 'Points',
      sortable: true,
      render: (value) =>
        value !== null && value !== undefined ? (
          <span>{String(value)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'epicKey',
      label: 'Epic',
      sortable: true,
      render: (value) =>
        value ? (
          <span className="font-mono text-sm">{String(value)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'priority',
      label: 'Priority',
      sortable: true,
      render: (value) =>
        value ? (
          <span className="text-sm">{String(value)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'assignee',
      label: 'Assignee',
      sortable: true,
      render: (value) =>
        value ? (
          <span className="text-sm">{String(value)}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KanbanNeverBoardedSection() {
  const [open, setOpen] = useState(false)

  const allBoards = useBoardsStore((s) => s.allBoards)
  const kanbanBoardIds = useBoardsStore((s) => s.kanbanBoardIds)

  // Derive only Kanban boards
  const kanbanBoards = useMemo(
    () => allBoards.filter((id) => kanbanBoardIds.has(id)),
    [allBoards, kanbanBoardIds],
  )

  // Board selector — auto-select the first Kanban board if available
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null)

  // Auto-select the first Kanban board when boards are loaded
  useEffect(() => {
    if (selectedBoard === null && kanbanBoards.length > 0) {
      setSelectedBoard(kanbanBoards[0])
    }
  }, [kanbanBoards, selectedBoard])

  // Period selector state — no Sprint option for Kanban
  const [periodMode, setPeriodMode] = useState<PeriodMode>('last90')
  const [selectedQuarter, setSelectedQuarter] = useState<string | null>(null)

  // Reset period + data when board changes
  useEffect(() => {
    setPeriodMode('last90')
    setSelectedQuarter(null)
    setData(null)
    setError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoard])

  // Fetch state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<UnplannedDoneResponse | null>(null)

  // Derive the effective params for the API call
  const fetchParams = useMemo(() => {
    if (!selectedBoard) return null

    const boardIdParam = selectedBoard

    if (periodMode === 'quarter' && selectedQuarter) {
      return { boardId: boardIdParam, quarter: selectedQuarter }
    }
    if (periodMode === 'last90') {
      return { boardId: boardIdParam, last90: true as const }
    }
    return null
  }, [selectedBoard, periodMode, selectedQuarter])

  // Fetch when params become available / change
  useEffect(() => {
    if (!fetchParams) {
      setData(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    getKanbanNeverBoarded(fetchParams)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 400) {
          setError('Not available for Scrum boards.')
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load Kanban never-boarded data')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fetchParams])

  // Summary stats: type breakdown chips
  const typeBreakdownChips = useMemo<{ label: string; value: number }[]>(() => {
    if (!data) return []
    return Object.entries(data.summary.byIssueType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ label: type, value: count }))
  }, [data])

  const columns = useMemo(() => buildColumns(), [])

  // Count shown in the section header badge
  const issueCount = data?.summary.total ?? 0

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted" />
          )}
          <span className="text-base font-semibold text-foreground">
            Kanban Never-Boarded Completions
          </span>
          {data && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {issueCount}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          <div className="space-y-3 px-5 py-4">
            {/* Board selector — Kanban boards only */}
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">Board</label>
              {kanbanBoards.length === 0 ? (
                <p className="text-sm text-muted">No Kanban boards configured.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {kanbanBoards.map((boardId) => (
                    <button
                      key={boardId}
                      type="button"
                      onClick={() => setSelectedBoard(boardId)}
                      className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                        selectedBoard === boardId
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-border text-muted hover:bg-gray-50'
                      }`}
                    >
                      {boardId}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Period mode tabs — no Sprint option */}
            <div>
              <label className="mb-2 block text-sm font-medium text-muted">Period</label>
              <div className="inline-flex rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setPeriodMode('last90')}
                  className={`rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${
                    periodMode === 'last90'
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-muted hover:bg-gray-50'
                  }`}
                >
                  Last 90 days
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodMode('quarter')}
                  className={`rounded-r-lg px-4 py-2 text-sm font-medium transition-colors ${
                    periodMode === 'quarter'
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-muted hover:bg-gray-50'
                  }`}
                >
                  Quarter
                </button>
              </div>
            </div>

            {/* Quarter selector */}
            {periodMode === 'quarter' && (
              <div className="max-w-xs">
                <QuarterSelect
                  value={selectedQuarter}
                  onChange={setSelectedQuarter}
                />
              </div>
            )}
          </div>

          {/* No board selected prompt */}
          {!selectedBoard && kanbanBoards.length > 0 && (
            <div className="px-5 pb-5">
              <p className="text-sm text-muted">
                Select a board to view never-boarded completions.
              </p>
            </div>
          )}

          {/* Data quality warning */}
          {!loading && !error && data?.dataQualityWarning && (
            <div className="mx-5 mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Board entry dates are not yet available for this board — run a sync and try again.
            </div>
          )}

          {/* Loading */}
          {selectedBoard && loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted" />
            </div>
          )}

          {/* Error */}
          {selectedBoard && !loading && error && (
            <div className="mx-5 mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Results */}
          {selectedBoard && !loading && !error && data && !data.dataQualityWarning && (
            <div className="space-y-4 pb-4">
              {/* Summary bar */}
              <div className="grid grid-cols-2 gap-3 px-5 sm:flex sm:flex-wrap">
                <StatChip label="Never-boarded tickets" value={data.summary.total} />
                <StatChip
                  label="Total points"
                  value={data.summary.totalPoints > 0 ? data.summary.totalPoints : '—'}
                />
                {typeBreakdownChips.map(({ label, value }) => (
                  <StatChip key={label} label={label} value={value} />
                ))}
              </div>

              {/* Issues table */}
              {data.issues.length === 0 ? (
                <div className="px-5 pb-2 text-sm text-muted">
                  No never-boarded completions found for the selected period.
                </div>
              ) : (
                <div className="px-5">
                  <DataTable<UnplannedDoneIssue>
                    columns={columns}
                    data={data.issues}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
