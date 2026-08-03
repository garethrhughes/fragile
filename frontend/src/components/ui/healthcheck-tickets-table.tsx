'use client'

/**
 * HealthcheckTicketsTable — the tickets included in the selected week's
 * denominator (every ticket whose first-ever start transition fell in the
 * week), with tick/dash flags for the three dimensions.
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
    getValue: (row) => (row.planned ? 1 : 0),
    render: (_v, row) => <Flag on={row.planned} />,
  },
  {
    key: 'onRoadmap',
    label: 'On Roadmap',
    sortable: true,
    getValue: (row) => (row.onRoadmap ? 1 : 0),
    render: (_v, row) => <Flag on={row.onRoadmap} />,
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
    </div>
  )
}
