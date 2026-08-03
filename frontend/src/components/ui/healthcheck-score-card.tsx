'use client'

/**
 * HealthcheckScoreCard — renders a single Healthcheck dimension score with its
 * RAG band colour, or an N/A empty state when the score is null.
 */
import type { HealthcheckDimension, HealthcheckBand } from '@/lib/api'

interface HealthcheckScoreCardProps {
  label: string
  dimension: HealthcheckDimension
  /** When true, a lower score is better (Support burden) — affects only copy. */
  lowerIsBetter?: boolean
}

const BAND_CLASSES: Record<HealthcheckBand, string> = {
  green: 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  red: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
}

export function HealthcheckScoreCard({ label, dimension, lowerIsBetter }: HealthcheckScoreCardProps) {
  const isNa = dimension.score === null
  const bandClass = dimension.band ? BAND_CLASSES[dimension.band] : 'border-border bg-card text-text-muted'

  return (
    <div className={`rounded-xl border p-4 ${bandClass}`} data-testid={`score-${label.toLowerCase()}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{label}</span>
        {lowerIsBetter && !isNa && (
          <span className="text-[10px] uppercase tracking-wide opacity-70">lower is better</span>
        )}
      </div>
      {isNa ? (
        <p className="mt-2 text-2xl font-bold text-text-muted">N/A</p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-bold tabular-nums">{dimension.score!.toFixed(1)}%</p>
          <p className="mt-1 text-xs opacity-80">
            {dimension.numerator} of {dimension.denominator} started
          </p>
        </>
      )}
    </div>
  )
}
