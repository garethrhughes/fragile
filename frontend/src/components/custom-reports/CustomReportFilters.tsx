'use client'

import type { CustomReportFilter } from '@/lib/api'
import type { ReportFilterValues } from '@/store/custom-report-filters-store'

interface Props {
  filters: CustomReportFilter[]
  values: ReportFilterValues
  onChange: (key: string, value: string | string[] | undefined) => void
}

export function CustomReportFilters({ filters, values, onChange }: Props) {
  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-card px-4 py-3">
      {filters.map((filter) => {
        const current = values[filter.key]

        if (filter.kind === 'multiselect') {
          // Collect unique options from defaultValue if provided, else no options shown statically
          // In practice the MCP caller sets filter definitions; we render a multi-chip selector
          const selected: string[] = Array.isArray(current) ? current : current ? [current] : []
          return (
            <div key={filter.id} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">{filter.label}</label>
              <input
                type="text"
                placeholder="val1, val2, …"
                aria-label={`${filter.label} (comma-separated)`}
                title="Enter comma-separated values"
                value={selected.join(', ')}
                onChange={(e) => {
                  const parts = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                  onChange(filter.key, parts.length > 0 ? parts : undefined)
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <span className="text-[10px] text-muted">comma-separated</span>
            </div>
          )
        }

        // select — single value
        return (
          <div key={filter.id} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">{filter.label}</label>
            <input
              type="text"
              placeholder="Filter value"
              value={typeof current === 'string' ? current : ''}
              onChange={(e) =>
                onChange(filter.key, e.target.value !== '' ? e.target.value : undefined)
              }
              className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )
      })}
      {Object.values(values).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined)) && (
        <button
          type="button"
          onClick={() => filters.forEach((f) => onChange(f.key, undefined))}
          className="self-end rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  )
}
