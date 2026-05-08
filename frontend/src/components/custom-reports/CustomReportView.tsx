'use client'

import { useMemo } from 'react'
import type { CustomReport } from '@/lib/api'
import { applyFilters } from '@/lib/custom-report-filtering'
import { resolveGridCols, resolveWidgetColSpan } from '@/lib/report-layout'
import { useCustomReportFiltersStore } from '@/store/custom-report-filters-store'
import { CustomReportFilters } from './CustomReportFilters'
import { CustomReportWidget } from './CustomReportWidget'
import { EmptyState } from '@/components/ui/empty-state'

interface Props {
  report: CustomReport
}

const GRID_COLS_CLASS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
}

const COL_SPAN_CLASS: Record<number, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
}

export function CustomReportView({ report }: Props) {
  const { valuesByReport, setFilterValue } = useCustomReportFiltersStore()
  const filterValues = valuesByReport[report.id] ?? {}

  const sortedWidgets = useMemo(
    () => [...report.widgets].sort((a, b) => a.position - b.position),
    [report.widgets],
  )

  const sortedFilters = useMemo(
    () => [...report.filters].sort((a, b) => a.position - b.position),
    [report.filters],
  )

  // Derive available options for each filter key from dimensions across all widget data points
  const filterOptions = useMemo(() => {
    const optionMap: Record<string, Set<string>> = {}
    for (const widget of report.widgets) {
      for (const point of widget.dataPoints) {
        if (!point.dimensions) continue
        for (const [key, val] of Object.entries(point.dimensions)) {
          if (typeof val !== 'string') continue
          if (!optionMap[key]) optionMap[key] = new Set()
          optionMap[key].add(val)
        }
      }
    }
    return Object.fromEntries(
      Object.entries(optionMap).map(([k, s]) => [k, Array.from(s).sort()]),
    ) as Record<string, string[]>
  }, [report.widgets])

  const cols = resolveGridCols(report.layout)
  const gridColsClass = GRID_COLS_CLASS[cols] ?? 'grid-cols-2'

  return (
    <div className="space-y-6">
      {/* Filters */}
      <CustomReportFilters
        filters={sortedFilters}
        options={filterOptions}
        values={filterValues}
        onChange={(key, value) => setFilterValue(report.id, key, value)}
      />

      {/* Widgets */}
      {sortedWidgets.length === 0 ? (
        <EmptyState
          title="No widgets yet"
          message="Add widgets to this report via the API or MCP."
        />
      ) : (
        <div className={`grid grid-cols-1 gap-6 ${gridColsClass}`}>
          {sortedWidgets.map((widget) => {
            const filteredPoints = applyFilters(widget.dataPoints, sortedFilters, filterValues)
            const colSpan = resolveWidgetColSpan(widget.kind, widget.id, report.layout, cols)
            const colSpanClass = COL_SPAN_CLASS[colSpan] ?? 'col-span-1'
            return (
              <div key={widget.id} className={colSpanClass}>
                <CustomReportWidget
                  widget={widget}
                  filteredPoints={filteredPoints}
                  jiraBaseUrl={report.jiraBaseUrl}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
