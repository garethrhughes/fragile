'use client'

/**
 * HealthcheckTicketsTable — the tickets included in the selected week's
 * denominator (every ticket whose first-ever start transition fell in the
 * week), with tick/dash flags for the three dimensions.
 *
 * Stability (Planned) and Roadmap (On Roadmap) do not apply to kanban boards
 * (ADR 0070/0074) — those cells render an explicit "N/A" pill so it's clear the
 * ticket is not counted toward those org metrics, rather than a plain dash
 * (which would read as "started but didn't qualify").
 */
import { ExternalLink, Check, Minus } from 'lucide-react'
import { DataTable, type Column } from '@/components/ui/data-table'
import type { HealthcheckTicket } from '@/lib/api'

function Flag({ on }: { on: boolean }) {
  return on ? (
    <Check className="h-4 w-4 text-green-600 dark:text-green-400" aria-label="yes" />
  ) : (
    <Minus className="h-4 w-4 text-text-muted" aria-label="no" />
  )
}

/** Not-applicable pill for dimensions that don't apply to the ticket's board. */
function NotApplicable() {
  return (
    <span
      className="inline-flex items-center rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted"
      title="Not counted in the overall metrics for kanban boards"
      aria-label="not applicable"
    >
      N/A
    </span>
  )
}

/** True when Stability/Roadmap apply to this ticket (scrum boards only). */
function dimensionApplies(ticket: HealthcheckTicket): boolean {
  return ticket.boardType !== 'kanban'
}

const columns: Column<HealthcheckTicket>[] = [
  {
    key: 'key',
    label: 'Key',
    sortable: true,
    render: (_v, row) =>
      row.jiraUrl ? (
        <a
          href={row.jiraUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-squirrel-600 hover:underline dark:text-squirrel-400"
        >
          {row.key}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="font-mono">{row.key}</span>
      ),
  },
  { key: 'summary', label: 'Summary', sortable: true },
  { key: 'boardId', label: 'Board', sortable: true },
  { key: 'issueType', label: 'Type', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  {
    key: 'planned',
    label: 'Planned',
    sortable: true,
    // Sort N/A (kanban) below both yes and no.
    getValue: (row) => (!dimensionApplies(row) ? -1 : row.planned ? 1 : 0),
    render: (_v, row) => (dimensionApplies(row) ? <Flag on={row.planned} /> : <NotApplicable />),
  },
  {
    key: 'onRoadmap',
    label: 'On Roadmap',
    sortable: true,
    getValue: (row) => (!dimensionApplies(row) ? -1 : row.onRoadmap ? 1 : 0),
    render: (_v, row) => (dimensionApplies(row) ? <Flag on={row.onRoadmap} /> : <NotApplicable />),
  },
  {
    key: 'support',
    label: 'Support',
    sortable: true,
    getValue: (row) => (row.support ? 1 : 0),
    render: (_v, row) => <Flag on={row.support} />,
  },
]

export function HealthcheckTicketsTable({ tickets }: { tickets: HealthcheckTicket[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">
        Included tickets ({tickets.length})
      </h3>
      <DataTable columns={columns} data={tickets} />
      <p className="text-xs text-text-muted">
        <span className="mr-1 inline-flex items-center rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
          N/A
        </span>
        Kanban tickets are not counted toward the Stability or Roadmap metrics.
      </p>
    </div>
  )
}
