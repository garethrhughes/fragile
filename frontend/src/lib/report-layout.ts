import type { WidgetKind } from '@/lib/api'

export interface WidgetLayoutOverride {
  colSpan?: number
}

export interface ReportLayout {
  /** Number of columns in the widget grid. Constrained to 1–6. Defaults to 2. */
  defaultColumns?: number
  /** Per-widget layout overrides, keyed by widget UUID. */
  widgets?: Record<string, WidgetLayoutOverride>
}

/**
 * Returns the number of grid columns for a report.
 * Falls back to 2 when layout is null/undefined or defaultColumns is not set.
 */
export function resolveGridCols(layout: ReportLayout | null | undefined): number {
  const cols = layout?.defaultColumns ?? 2
  return Math.min(Math.max(cols, 1), 6)
}

/**
 * Returns the colSpan for a single widget.
 *
 * Resolution order:
 * 1. Explicit per-widget override in layout.widgets[widgetId].colSpan (clamped to 1–cols)
 * 2. Table widgets default to full width (cols)
 * 3. All other widgets default to 1
 */
export function resolveWidgetColSpan(
  kind: WidgetKind,
  widgetId: string,
  layout: ReportLayout | null | undefined,
  cols: number,
): number {
  const normalizedCols = Math.max(Math.min(cols, 6), 1)
  const override = layout?.widgets?.[widgetId]?.colSpan
  if (override !== undefined) {
    return Math.min(Math.max(override, 1), normalizedCols)
  }
  if (kind === 'table') {
    return normalizedCols
  }
  return 1
}
