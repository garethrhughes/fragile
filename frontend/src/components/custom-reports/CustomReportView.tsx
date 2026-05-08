'use client'

import { useMemo } from 'react'
import type { CustomReport } from '@/lib/api'
import { applyFilters } from '@/lib/custom-report-filtering'
import { useCustomReportFiltersStore } from '@/store/custom-report-filters-store'
import { CustomReportFilters } from './CustomReportFilters'
import { CustomReportGraph } from './CustomReportGraph'
import { EmptyState } from '@/components/ui/empty-state'

interface Props {
  report: CustomReport
}

export function CustomReportView({ report }: Props) {
  const { valuesByReport, setFilterValue } = useCustomReportFiltersStore()
  const filterValues = valuesByReport[report.id] ?? {}

  const sortedGraphs = useMemo(
    () => [...report.graphs].sort((a, b) => a.position - b.position),
    [report.graphs],
  )

  const sortedFilters = useMemo(
    () => [...report.filters].sort((a, b) => a.position - b.position),
    [report.filters],
  )

  // Derive available options for each filter key from dimensions across all graph data points
  const filterOptions = useMemo(() => {
    const optionMap: Record<string, Set<string>> = {}
    for (const graph of report.graphs) {
      for (const point of graph.dataPoints) {
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
  }, [report.graphs])

  return (
    <div className="space-y-6">
      {/* Filters */}
      <CustomReportFilters
        filters={sortedFilters}
        options={filterOptions}
        values={filterValues}
        onChange={(key, value) => setFilterValue(report.id, key, value)}
      />

      {/* Graphs */}
      {sortedGraphs.length === 0 ? (
        <EmptyState
          title="No graphs yet"
          message="Add graphs to this report via the API or MCP."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {sortedGraphs.map((graph) => {
            const filteredPoints = applyFilters(graph.dataPoints, sortedFilters, filterValues)
            return (
              <CustomReportGraph
                key={graph.id}
                graph={graph}
                filteredPoints={filteredPoints}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
