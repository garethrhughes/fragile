'use client'

import { useMemo } from 'react'
import type { CustomReport } from '@/lib/api'
import { applyFilters } from '@/lib/custom-report-filtering'
import { useCustomReportFiltersStore } from '@/store/custom-report-filters-store'
import { CustomReportFilters } from './CustomReportFilters'
import { CustomReportWidget } from './CustomReportWidget'
import { EmptyState } from '@/components/ui/empty-state'

interface Props {
  report: CustomReport
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {sortedWidgets.map((widget) => {
            const filteredPoints = applyFilters(widget.dataPoints, sortedFilters, filterValues)
            return (
              <CustomReportWidget
                key={widget.id}
                widget={widget}
                filteredPoints={filteredPoints}
                jiraBaseUrl={report.jiraBaseUrl}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
