'use client'

/**
 * HealthCheckPanel — weekly engineering Health Check.
 *
 * Feature 0014 / Proposal 0071. Renders above the Pulse report on /all-items,
 * only for completed (non-current) weeks. Surfaces per-board Stability and
 * Roadmap Delivery with volume context, RAG bands, a 4-week trend, and an
 * org-level RAG distribution (never a single averaged score).
 */

import type {
  HealthCheckReport,
  HealthCheckBoard,
  HealthBand,
  HealthBandDistribution,
} from '@/lib/api'

function bandClasses(band: HealthBand | null): string {
  switch (band) {
    case 'healthy':
      return 'bg-green-100 text-green-800 border-green-200'
    case 'watch':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200'
    case 'at-risk':
      return 'bg-red-100 text-red-800 border-red-200'
    default:
      return 'bg-surface-alt text-muted border-border'
  }
}

function bandLabel(band: HealthBand): string {
  return band === 'at-risk' ? 'At risk' : band.charAt(0).toUpperCase() + band.slice(1)
}

function ScoreBadge({ score, band }: { score: number | null; band: HealthBand | null }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-semibold ${bandClasses(band)}`}
    >
      {score === null ? 'n/a' : `${score}%`}
    </span>
  )
}

/** Compact 4-point sparkline-style trend using simple bars. */
function TrendBars({ points }: { points: (number | null)[] }) {
  return (
    <div className="flex items-end gap-0.5" aria-hidden="true">
      {points.map((p, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-blue-400"
          style={{ height: `${Math.max(2, ((p ?? 0) / 100) * 24)}px` }}
        />
      ))}
    </div>
  )
}

function volumeText(board: HealthCheckBoard): string {
  if (board.volume.boardType === 'scrum') {
    const { committed, added, completed } = board.volume
    return `committed ${committed} · added ${added} · completed ${completed}`
  }
  const { pulledIn, completed } = board.volume
  return `pulled in ${pulledIn} · completed ${completed}`
}

function roadmapContext(board: HealthCheckBoard): string {
  const support = board.volume.support
  const supportSuffix = support > 0 ? ` · ${support} support (context)` : ''
  if (board.roadmapScore === null) return `nothing completed${supportSuffix}`
  const { completed, onRoadmap } = board.volume
  return `${onRoadmap} of ${completed} completed on-roadmap${supportSuffix}`
}

function DistributionBar({
  label,
  dist,
}: {
  label: string
  dist: HealthBandDistribution
}) {
  const parts: { key: string; count: number; band: HealthBand | null; text: string }[] = [
    { key: 'healthy', count: dist.healthy, band: 'healthy', text: 'healthy' },
    { key: 'watch', count: dist.watch, band: 'watch', text: 'watch' },
    { key: 'atRisk', count: dist.atRisk, band: 'at-risk', text: 'at risk' },
    { key: 'na', count: dist.na, band: null, text: 'n/a' },
  ]
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {parts
          .filter((p) => p.count > 0)
          .map((p) => (
            <span
              key={p.key}
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${bandClasses(p.band)}`}
            >
              {p.count} {p.text}
            </span>
          ))}
      </div>
    </div>
  )
}

export function HealthCheckPanel({ report }: { report: HealthCheckReport }) {
  return (
    <section
      aria-label="Engineering Health Check"
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold">Health Check</h2>
          <p className="text-xs text-muted">
            Weekly stability &amp; roadmap delivery — completed weeks only
          </p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <DistributionBar label="Stability" dist={report.stabilityDistribution} />
          <DistributionBar label="Roadmap" dist={report.roadmapDistribution} />
        </div>
      </div>

      {report.boards.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted">No boards with data this week.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  Team
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  Stability
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  Roadmap delivery
                </th>
                <th className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted">
                  4-wk trend
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.boards.map((board) => (
                <tr key={board.boardId} className="align-top">
                  <td className="px-3 py-3">
                    <div className="font-mono text-sm font-bold">{board.boardId}</div>
                    <div className="text-xs text-muted">{board.boardType}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <ScoreBadge score={board.stabilityScore} band={board.stabilityBand} />
                    </div>
                    <div className="mt-1 text-xs text-muted">{volumeText(board)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <ScoreBadge score={board.roadmapScore} band={board.roadmapBand} />
                    </div>
                    <div className="mt-1 text-xs text-muted">{roadmapContext(board)}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col items-center">
                          <TrendBars points={board.trend.map((t) => t.stabilityScore)} />
                          <span className="text-[10px] text-muted">stab</span>
                        </div>
                        <div className="flex flex-col items-center">
                          <TrendBars points={board.trend.map((t) => t.roadmapScore)} />
                          <span className="text-[10px] text-muted">road</span>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
