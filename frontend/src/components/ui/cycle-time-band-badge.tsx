'use client'

import { type CycleTimeBand, cycleTimeBandColor } from '@/lib/cycle-time-bands'

interface CycleTimeBandBadgeProps {
  band: CycleTimeBand | null
}

export function CycleTimeBandBadge({ band }: CycleTimeBandBadgeProps) {
  // Proposal 0054: null band → no badge (caller is responsible for the
  // surrounding empty state).
  if (band === null) return null
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cycleTimeBandColor(band)}`}
    >
      {band}
    </span>
  )
}
