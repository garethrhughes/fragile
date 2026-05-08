import { describe, it, expect } from 'vitest'
import { resolveGridCols, resolveWidgetColSpan } from './report-layout'
import type { ReportLayout } from './report-layout'

describe('resolveGridCols', () => {
  it('returns 2 when layout is null', () => {
    expect(resolveGridCols(null)).toBe(2)
  })

  it('returns 2 when layout is undefined', () => {
    expect(resolveGridCols(undefined)).toBe(2)
  })

  it('returns 2 when layout has no defaultColumns', () => {
    expect(resolveGridCols({})).toBe(2)
  })

  it('returns defaultColumns when set', () => {
    expect(resolveGridCols({ defaultColumns: 3 })).toBe(3)
  })

  it('returns 1 when defaultColumns is 1', () => {
    expect(resolveGridCols({ defaultColumns: 1 })).toBe(1)
  })

  it('returns 6 when defaultColumns is 6', () => {
    expect(resolveGridCols({ defaultColumns: 6 })).toBe(6)
  })
})

describe('resolveWidgetColSpan', () => {
  it('returns 1 for a non-table widget with no override', () => {
    expect(resolveWidgetColSpan('line', 'w1', null, 2)).toBe(1)
  })

  it('returns full width (defaultColumns) for a table widget with no override', () => {
    expect(resolveWidgetColSpan('table', 'w1', null, 2)).toBe(2)
  })

  it('returns full width for table widget in a 3-column layout', () => {
    expect(resolveWidgetColSpan('table', 'w1', null, 3)).toBe(3)
  })

  it('returns colSpan override for a table widget when override is set', () => {
    const layout: ReportLayout = { widgets: { w1: { colSpan: 2 } } }
    expect(resolveWidgetColSpan('table', 'w1', layout, 3)).toBe(2)
  })

  it('returns colSpan override for a non-table widget', () => {
    const layout: ReportLayout = { widgets: { w1: { colSpan: 2 } } }
    expect(resolveWidgetColSpan('line', 'w1', layout, 3)).toBe(2)
  })

  it('clamps colSpan override to defaultColumns when override exceeds grid', () => {
    const layout: ReportLayout = { widgets: { w1: { colSpan: 5 } } }
    expect(resolveWidgetColSpan('line', 'w1', layout, 3)).toBe(3)
  })

  it('clamps colSpan override to 1 when override is below minimum', () => {
    const layout: ReportLayout = { widgets: { w1: { colSpan: 0 } } }
    expect(resolveWidgetColSpan('line', 'w1', layout, 3)).toBe(1)
  })

  it('returns 1 for non-table widget when no entry for the widget id exists', () => {
    const layout: ReportLayout = { widgets: { other: { colSpan: 2 } } }
    expect(resolveWidgetColSpan('bar', 'w1', layout, 2)).toBe(1)
  })

  it('returns defaultColumns for table widget when no entry for the widget id exists', () => {
    const layout: ReportLayout = { widgets: { other: { colSpan: 2 } } }
    expect(resolveWidgetColSpan('table', 'w1', layout, 3)).toBe(3)
  })
})
