'use client'

import type { ReactNode } from 'react'
import type {
  CustomReportWidget,
  CustomReportDataPoint,
  ColumnDefinition,
  ColumnType,
} from '@/lib/api'
import { DataTable, type Column } from '@/components/ui/data-table'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { StatusBadge } from '@/components/ui/status-badge'

interface Props {
  widget: CustomReportWidget
  filteredPoints: CustomReportDataPoint[]
  jiraBaseUrl: string
}

// A flat record projected from a data point — all fields are string | number | null.
export type RowRecord = Record<string, string | number | null>

/** Merge x, y, series + dimensions into a flat row object. */
export function projectPoints(points: CustomReportDataPoint[]): RowRecord[] {
  return points.map((p) => ({
    x: p.x,
    y: p.y,
    series: p.series,
    ...p.dimensions,
  }))
}

function renderCell(
  type: ColumnType,
  colKey: string,
  value: unknown,
  row: RowRecord,
  jiraBaseUrl: string,
): ReactNode {
  const str = value != null ? String(value) : ''

  switch (type) {
    case 'text':
      return <span>{str}</span>

    case 'number':
      return <span className="text-right tabular-nums">{str}</span>

    case 'status':
      return str ? <StatusBadge status={str} /> : null

    case 'priority':
      return str ? <PriorityBadge priority={str} /> : null

    case 'issue': {
      if (!str) return null
      const href = jiraBaseUrl ? `${jiraBaseUrl}/browse/${str}` : undefined
      return href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-blue-600 underline hover:text-blue-800"
        >
          {str}
        </a>
      ) : (
        <span className="font-mono text-xs">{str}</span>
      )
    }

    case 'link': {
      if (!str) return null
      const labelKey = `${colKey}_label`
      const label = (row[labelKey] as string | null | undefined) ?? str
      // Guard against javascript: URIs — only allow http(s) scheme links
      const safeHref = /^https?:\/\//i.test(str) ? str : undefined
      return safeHref ? (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline hover:text-blue-800"
        >
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )
    }

    case 'icon': {
      // Renders the icon name as text; a full Lucide dynamic import would require
      // a separate registry. Displaying text is safe and avoids dynamic imports.
      return <span className="text-xs text-muted-foreground">{str}</span>
    }

    default:
      return <span>{str}</span>
  }
}

function buildColumns(
  defs: ColumnDefinition[],
  jiraBaseUrl: string,
): Column<RowRecord>[] {
  return defs.map((def) => ({
    key: def.key,
    label: def.label,
    sortable: def.sortable !== false,
    render: (value: unknown, row: RowRecord) =>
      renderCell(def.type, def.key, value, row, jiraBaseUrl),
  }))
}

export function TableWidget({ widget, filteredPoints, jiraBaseUrl }: Props) {
  const columns = buildColumns(widget.columns ?? [], jiraBaseUrl)
  const data = projectPoints(filteredPoints)

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-semibold">{widget.title}</h3>
      <DataTable columns={columns} data={data} />
    </div>
  )
}
