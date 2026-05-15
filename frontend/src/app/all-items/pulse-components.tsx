'use client'

/**
 * Pulse page extracted components (proposal 0069 / ADR 0065).
 *
 * Exported for testing:
 *   - TotalsStrip   — single-row summary strip replacing 7 individual stat tiles
 *   - BoardTable    — <table> wrapper rendering one BoardRow per board
 *   - BoardRow      — single <tr> for a board with inline expand/collapse
 *
 * IssueTable is re-exported from page.tsx (unchanged); it renders inside the
 * expanded <tr> produced by BoardRow.
 */

import { useState } from 'react'
import type {
  AllItemsBoardResult,
  AllItemsTotals,
  AllItemsIssue,
  BoardHealthScore,
} from '@/lib/api'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function HealthBadge({ score }: { score: number }) {
  const colour =
    score >= 80
      ? 'bg-green-100 text-green-800 border-green-200'
      : score >= 60
        ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
        : 'bg-red-100 text-red-800 border-red-200'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-semibold ${colour}`}>
      {score}
    </span>
  )
}

function Pct({ value }: { value: number }) {
  return <span className="tabular-nums">{value}%</span>
}

// ---------------------------------------------------------------------------
// TotalsStrip
// ---------------------------------------------------------------------------

export interface TotalsStripProps {
  totals: AllItemsTotals
  overallScore: number
}

export function TotalsStrip({ totals, overallScore }: TotalsStripProps) {
  const items: { label: string; value: React.ReactNode }[] = [
    { label: 'Overall', value: <HealthBadge score={overallScore} /> },
    { label: 'Total items', value: totals.totalItems },
    { label: 'Completed', value: totals.completedCount },
    { label: 'On roadmap', value: totals.onRoadmapCount },
    { label: 'In flight', value: totals.inFlightCount },
    { label: 'Support', value: totals.supportCount },
    { label: 'TTB', value: totals.ttbSupportCount },
  ]

  return (
    <div className="flex divide-x divide-border rounded-lg border border-border bg-card text-center text-sm">
      {items.map(({ label, value }) => (
        <div key={label} className="flex flex-1 flex-col items-center justify-center px-3 py-1.5">
          <span className="font-bold">{value}</span>
          <span className="text-xs text-muted">{label}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// IssueTable (inline — used by BoardRow for the expanded drill-down)
// ---------------------------------------------------------------------------

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

function IssueTable({ items }: { items: AllItemsIssue[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border bg-table-header-bg">
          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Issue</th>
          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Summary</th>
          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Type</th>
          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Status</th>
          <th className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">Sprint</th>
          <th className="px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-muted">Flags</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {items.map((item) => (
          <tr key={item.key} className="hover:bg-interactive-hover-bg">
            <td className="px-3 py-1.5 font-mono text-xs">
              {item.jiraUrl ? (
                <a href={item.jiraUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {item.key}
                </a>
              ) : (
                <span className="text-blue-600">{item.key}</span>
              )}
            </td>
            <td className="max-w-xs truncate px-3 py-1.5 text-foreground">{item.summary}</td>
            <td className="px-3 py-1.5 text-xs text-muted">{item.issueType}</td>
            <td className="px-3 py-1.5 text-xs text-muted">{item.status}</td>
            <td className="px-3 py-1.5 text-xs text-muted">{item.sprintName ?? '—'}</td>
            <td className="px-3 py-1.5">
              <div className="flex flex-wrap justify-center gap-1">
                {item.started && <FlagBadge label="started" colour="blue" />}
                {item.inFlight && <FlagBadge label="in flight" colour="blue" />}
                {item.completed && <FlagBadge label="done" colour="green" />}
                {item.addedMidSprint && <FlagBadge label="mid-sprint" colour="orange" />}
                {item.kanbanAdd && <FlagBadge label="mid-week" colour="orange" />}
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

// ---------------------------------------------------------------------------
// BoardRow
// ---------------------------------------------------------------------------

export interface BoardRowProps {
  board: AllItemsBoardResult
}

/**
 * Single table row for a board. Clicking the expand button opens an inline
 * <tr> beneath it containing the full IssueTable drill-down.
 */
export function BoardRow({ board }: BoardRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { summary, healthScore, boardType } = board
  const isKanban = boardType === 'kanban'
  const COL_SPAN = 9

  return (
    <>
      <tr className="border-b border-border hover:bg-interactive-hover-bg">
        {/* Board ID */}
        <td className="px-3 py-2 font-mono text-xs font-bold text-foreground">{board.boardId}</td>

        {/* Type badge */}
        <td className="px-3 py-2">
          <span className="rounded-full border border-border bg-surface-alt px-1.5 py-0.5 text-xs text-muted">
            {boardType}
          </span>
        </td>

        {/* Pulled In / Total */}
        <td className="px-3 py-2 text-right tabular-nums text-sm font-medium">{summary.totalItems}</td>

        {/* Added (scrum) / — (kanban) */}
        <td className="px-3 py-2 text-right tabular-nums text-sm text-muted">
          {isKanban ? '—' : summary.addedMidSprintCount}
        </td>

        {/* In Flight (kanban) / — (scrum) */}
        <td className="px-3 py-2 text-right tabular-nums text-sm text-muted">
          {isKanban ? summary.inFlightCount : '—'}
        </td>

        {/* Completed */}
        <td className="px-3 py-2 text-right tabular-nums text-sm font-medium">{summary.completedCount}</td>

        {/* On roadmap */}
        <td className="px-3 py-2 text-right tabular-nums text-sm text-muted">{summary.onRoadmapCount}</td>

        {/* Roadmap % + Stability % */}
        <td className="px-3 py-2 text-right text-xs text-muted">
          {summary.completedCount === 0 ? 'n/a' : <Pct value={healthScore.roadmapAlignmentScore} />}
          {' / '}
          <Pct value={healthScore.stabilityScore} />
        </td>

        {/* Health */}
        <td className="px-3 py-2 text-center">
          <HealthBadge score={healthScore.overall} />
        </td>

        {/* Expand */}
        <td className="px-2 py-2 text-center">
          {board.items.length > 0 ? (
            <button
              type="button"
              aria-label={expanded ? 'Collapse items' : 'Expand items'}
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-muted hover:text-foreground"
            >
              {expanded ? '▾' : '▸'}
            </button>
          ) : (
            <span className="text-xs text-muted">—</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={COL_SPAN + 1} className="border-b border-border bg-surface-alt p-0">
            <div className="overflow-x-auto">
              <IssueTable items={board.items} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// BoardTable
// ---------------------------------------------------------------------------

export interface BoardTableProps {
  boards: AllItemsBoardResult[]
}

const COLUMN_HEADERS: { label: string; title?: string; align: 'left' | 'right' | 'center' }[] = [
  { label: 'Board', align: 'left' },
  { label: 'Type', align: 'left' },
  { label: 'Pulled In', title: 'Issues pulled into the board (kanban) or total sprint items (scrum) this week', align: 'right' },
  { label: 'Added', title: 'Issues added mid-sprint (scrum only; — for kanban)', align: 'right' },
  { label: 'In Flight', title: 'Issues currently on the board, not done or cancelled (kanban only; — for scrum)', align: 'right' },
  { label: 'Completed', title: 'Issues moved to a done status this week', align: 'right' },
  { label: 'Roadmap', title: 'Count of completed issues that are linked to a roadmap idea', align: 'right' },
  { label: 'Align / Stability', title: 'Roadmap alignment % / Stability %. Roadmap: completed items on or before target date. Stability: kanban = completed ÷ entered; scrum = committed items %', align: 'right' },
  { label: 'Health', title: 'Overall health score (average of roadmap alignment and stability)', align: 'center' },
  { label: '', align: 'center' },
]

export function BoardTable({ boards }: BoardTableProps) {
  if (boards.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-8 text-center text-sm text-muted">
        No boards configured.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-table-header-bg">
            {COLUMN_HEADERS.map(({ label, title, align }) => (
              <th
                key={label || '_expand'}
                title={title}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${title ? 'cursor-help underline decoration-dotted' : ''}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {boards.map((board) => (
            <BoardRow key={board.boardId} board={board} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Re-export HealthBadge for use in the page's overall score display
export { HealthBadge }
export type { BoardHealthScore }
