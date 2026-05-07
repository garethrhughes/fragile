'use client'

interface SupportPercentageStatProps {
  percentage: number
  supportIssues: number
  totalIssues: number
}

function percentageBorderColor(pct: number): string {
  if (pct <= 10) return 'border-l-green-400'
  if (pct <= 25) return 'border-l-amber-400'
  return 'border-l-red-400'
}

function percentageBadgeColor(pct: number): string {
  if (pct <= 10) return 'bg-green-100 text-green-800 border-green-200'
  if (pct <= 25) return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-red-100 text-red-800 border-red-200'
}

function percentageLabel(pct: number): string {
  if (pct <= 10) return 'low'
  if (pct <= 25) return 'moderate'
  return 'high'
}

export function SupportPercentageStat({
  percentage,
  supportIssues,
  totalIssues,
}: SupportPercentageStatProps) {
  return (
    <div
      className={`rounded-xl border bg-card p-5 shadow-sm border-l-4 ${percentageBorderColor(percentage)}`}
    >
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-muted">Support Load</h3>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${percentageBadgeColor(percentage)}`}
        >
          {percentageLabel(percentage)}
        </span>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-bold tracking-tight">
          {percentage.toFixed(1)}%
        </span>
        <span className="mb-1 text-sm text-muted">of issues</span>
      </div>
      <div className="mt-3 text-xs text-muted">
        {supportIssues} support / {totalIssues} total
      </div>
    </div>
  )
}
