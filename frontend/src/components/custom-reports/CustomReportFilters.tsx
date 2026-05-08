'use client'

import type { CustomReportFilter } from '@/lib/api'
import type { ReportFilterValues } from '@/store/custom-report-filters-store'

interface Props {
  filters: CustomReportFilter[]
  options: Record<string, string[]>
  values: ReportFilterValues
  onChange: (key: string, value: string | string[] | undefined) => void
}

export function CustomReportFilters({ filters, options, values, onChange }: Props) {
  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap gap-4 rounded-xl border border-border bg-card px-4 py-3">
      {filters.map((filter) => {
        const current = values[filter.key]
        const opts = options[filter.key] ?? []

        if (filter.kind === 'multiselect') {
          const selected: string[] = Array.isArray(current)
            ? current
            : current
              ? [current]
              : []

          if (opts.length === 0) {
            // No options derived yet — fall back to comma-separated text input
            return (
              <div key={filter.id} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted">{filter.label}</label>
                <input
                  type="text"
                  placeholder="val1, val2, …"
                  aria-label={`${filter.label} (comma-separated)`}
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

          return (
            <div key={filter.id} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">{filter.label}</label>
              <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 text-sm max-h-36 overflow-y-auto">
                {opts.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer hover:text-foreground text-text-secondary">
                    <input
                      type="checkbox"
                      checked={selected.includes(opt)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selected, opt]
                          : selected.filter((v) => v !== opt)
                        onChange(filter.key, next.length > 0 ? next : undefined)
                      }}
                      className="accent-primary"
                    />
                    <span className="truncate max-w-[160px]">{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        }

        // select — single value dropdown
        const selectValue = typeof current === 'string' ? current : ''

        if (opts.length === 0) {
          return (
            <div key={filter.id} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">{filter.label}</label>
              <input
                type="text"
                placeholder="Filter value"
                value={selectValue}
                onChange={(e) =>
                  onChange(filter.key, e.target.value !== '' ? e.target.value : undefined)
                }
                className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )
        }

        return (
          <div key={filter.id} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted">{filter.label}</label>
            <select
              value={selectValue}
              onChange={(e) =>
                onChange(filter.key, e.target.value !== '' ? e.target.value : undefined)
              }
              className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All</option>
              {opts.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
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
