'use client'

import type { CustomReportWidget, CustomReportDataPoint, StatBand } from '@/lib/api'
import { BandBadge } from '@/components/ui/band-badge'
import type { DoraBand } from '@/lib/api'

interface Props {
  widget: CustomReportWidget
  filteredPoints: CustomReportDataPoint[]
}

const BAND_BORDER: Record<StatBand, string> = {
  elite: 'border-l-green-500',
  high: 'border-l-blue-500',
  medium: 'border-l-amber-500',
  low: 'border-l-red-500',
  none: 'border-l-border',
}

function borderClass(band: StatBand | null): string {
  if (!band || band === 'none') return 'border-l-border'
  return BAND_BORDER[band]
}

export function StatWidget({ widget, filteredPoints }: Props) {
  const primaryValue = filteredPoints[0]?.y ?? null

  return (
    <div
      className={`rounded-xl border border-border border-l-4 ${borderClass(widget.statBand)} bg-card p-4`}
    >
      <div className="mb-2 flex items-start justify-between">
        <span className="text-xs font-medium text-muted-foreground">{widget.title}</span>
        {widget.statBand && widget.statBand !== 'none' && (
          <BandBadge band={widget.statBand as DoraBand} />
        )}
      </div>

      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums">
          {primaryValue !== null ? primaryValue : '—'}
        </span>
        {widget.statUnit && (
          <span className="text-sm text-muted-foreground">{widget.statUnit}</span>
        )}
      </div>

      {widget.statSubtitle && (
        <p className="mt-1 text-xs text-muted-foreground">{widget.statSubtitle}</p>
      )}
    </div>
  )
}
