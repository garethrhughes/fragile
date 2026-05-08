import type { CustomReportDataPoint, CustomReportFilter } from './api'
import type { ReportFilterValues } from '../store/custom-report-filters-store'

/**
 * Apply declared filter values to a set of data points.
 *
 * Each filter selects data points whose `dimensions[filter.key]` matches the
 * active value.  Points without a matching dimension key are **excluded** when
 * a filter value is active.
 *
 * Rules:
 * - If no filter has an active value, all points are returned unchanged.
 * - `select` filter: single-value equality match.
 * - `multiselect` filter: point must match at least one of the selected values.
 * - An undefined / empty-array value means "no filter applied" for that key.
 *
 * Pure function — no side effects.
 */
export function applyFilters(
  points: CustomReportDataPoint[],
  filters: CustomReportFilter[],
  values: ReportFilterValues,
): CustomReportDataPoint[] {
  const activeFilters = filters.filter((f) => {
    const v = values[f.key]
    if (v === undefined) return false
    if (Array.isArray(v)) return v.length > 0
    return v !== ''
  })

  if (activeFilters.length === 0) return points

  return points.filter((point) =>
    activeFilters.every((filter) => {
      const dimValue = point.dimensions?.[filter.key]
      if (dimValue === undefined || dimValue === null) return false
      const selected = values[filter.key]
      if (Array.isArray(selected)) {
        return selected.includes(dimValue)
      }
      return dimValue === selected
    }),
  )
}
