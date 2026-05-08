import { describe, it, expect } from 'vitest'
import { applyFilters } from './custom-report-filtering'
import type { CustomReportDataPoint, CustomReportFilter } from './api'

const makePoint = (
  id: string,
  x: string,
  y: number,
  dimensions?: Record<string, string>,
): CustomReportDataPoint => ({
  id,
  x,
  y,
  series: null,
  dimensions: dimensions ?? null,
  createdAt: '2024-01-01T00:00:00Z',
})

const makeFilter = (key: string, kind: 'select' | 'multiselect' = 'select'): CustomReportFilter => ({
  id: `filter-${key}`,
  customReportId: 'r1',
  key,
  label: key,
  kind,
  defaultValue: null,
  position: 0,
})

describe('applyFilters', () => {
  const points = [
    makePoint('1', '2024-01', 10, { team: 'ACC', env: 'prod' }),
    makePoint('2', '2024-02', 20, { team: 'BPT', env: 'prod' }),
    makePoint('3', '2024-03', 30, { team: 'ACC', env: 'staging' }),
    makePoint('4', '2024-04', 40, { team: 'OCS' }),
  ]
  const filters = [makeFilter('team'), makeFilter('env', 'multiselect')]

  it('returns all points when no filter values are set', () => {
    expect(applyFilters(points, filters, {})).toHaveLength(4)
  })

  it('filters by a single select value', () => {
    const result = applyFilters(points, filters, { team: 'ACC' })
    expect(result.map((p) => p.id)).toEqual(['1', '3'])
  })

  it('filters by multiselect value (OR match)', () => {
    const result = applyFilters(points, filters, { env: ['prod', 'staging'] })
    expect(result.map((p) => p.id)).toEqual(['1', '2', '3'])
  })

  it('applies multiple filters together (AND logic)', () => {
    const result = applyFilters(points, filters, { team: 'ACC', env: ['prod'] })
    expect(result.map((p) => p.id)).toEqual(['1'])
  })

  it('excludes points that lack the filtered dimension key', () => {
    // point '4' has no 'env' key
    const result = applyFilters(points, filters, { env: ['prod'] })
    expect(result.map((p) => p.id)).not.toContain('4')
  })

  it('treats empty array as no filter for that key', () => {
    const result = applyFilters(points, filters, { env: [] })
    expect(result).toHaveLength(4)
  })

  it('treats undefined value as no filter', () => {
    const result = applyFilters(points, filters, { team: undefined })
    expect(result).toHaveLength(4)
  })

  it('returns empty array when no points match', () => {
    const result = applyFilters(points, filters, { team: 'DATA' })
    expect(result).toHaveLength(0)
  })
})
