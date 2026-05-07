import type { ScoreDimension, SprintReportBand } from '@/lib/api'

// ---------------------------------------------------------------------------
// Display labels for each scoring dimension
// (kept locally — mirrors DIMENSION_LABELS in the sprint-report page)
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  deliveryRate: 'Delivery Rate',
  scopeStability: 'Scope Stability',
  roadmapCoverage: 'Roadmap Coverage',
  leadTime: 'Lead Time',
  deploymentFrequency: 'Deployment Frequency',
  changeFailureRate: 'Change Failure Rate',
  mttr: 'MTTR',
}

function reportBandColor(band: SprintReportBand | null): string {
  if (band === null) return 'text-muted'
  switch (band) {
    case 'strong':
      return 'text-green-600'
    case 'good':
      return 'text-blue-600'
    case 'fair':
      return 'text-amber-600'
    case 'needs-attention':
      return 'text-red-600'
  }
}

function reportBandLabel(band: SprintReportBand | null): string {
  if (band === null) return 'Insufficient data'
  switch (band) {
    case 'strong':
      return 'Strong'
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair'
    case 'needs-attention':
      return 'Needs Attention'
  }
}

export interface CompositeScoreDisplayProps {
  compositeScore: number | null
  compositeBand: SprintReportBand | null
  totalWeightApplied: number
  excludedDimensions: ScoreDimension[]
}

/**
 * Pure presentation component for the composite score block on the sprint
 * report page. Renders one of three states:
 *
 *   1. `compositeScore === null` → "Insufficient data" + tooltip listing
 *      excluded dimensions.
 *   2. `totalWeightApplied < 1` → `~{score}` modifier + band label +
 *      footnote describing the excluded dimensions and weight applied.
 *   3. Otherwise → full score + band label.
 *
 * See proposal 0051 / ADR 0053 for the renormalisation semantics.
 */
export function CompositeScoreDisplay({
  compositeScore,
  compositeBand,
  totalWeightApplied,
  excludedDimensions,
}: CompositeScoreDisplayProps) {
  const excludedLabels = excludedDimensions
    .map((d) => DIMENSION_LABELS[d] ?? d)
    .join(', ')
  const showApproximate = totalWeightApplied < 1 && compositeScore !== null

  return (
    <div className="flex flex-col items-center rounded-xl border border-border bg-card py-8 shadow-sm">
      <p className="text-sm font-medium text-muted">Composite Score</p>
      {compositeScore === null ? (
        <>
          <p
            className="mt-2 text-3xl font-semibold text-muted"
            title={excludedLabels ? `Excluded: ${excludedLabels}` : undefined}
          >
            Insufficient data
          </p>
          <p className="mt-3 text-sm text-muted">
            No dimension produced a usable score for this sprint.
          </p>
        </>
      ) : (
        <>
          <p
            className={`mt-2 text-6xl font-bold tabular-nums leading-none ${reportBandColor(compositeBand)}`}
            title={showApproximate ? `Approximate — excludes: ${excludedLabels}` : undefined}
          >
            {showApproximate ? '~' : ''}
            {compositeScore.toFixed(1)}
          </p>
          <p className={`mt-3 text-lg font-semibold ${reportBandColor(compositeBand)}`}>
            {reportBandLabel(compositeBand)}
          </p>
          {showApproximate && (
            <p className="mt-2 text-xs text-muted" title={excludedLabels}>
              Computed from {Math.round(totalWeightApplied * 100)}% of weights
              {' — '}excludes: {excludedLabels}
            </p>
          )}
        </>
      )}
    </div>
  )
}
