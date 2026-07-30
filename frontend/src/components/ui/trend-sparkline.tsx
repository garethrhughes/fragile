'use client'

import { LineChart, Line, YAxis } from 'recharts'

interface TrendSparklineProps {
  /** Values oldest → newest. `null` points are skipped (line connects across gaps). */
  points: (number | null)[]
  /** Line colour. Defaults to a muted blue. */
  color?: string
  width?: number
  height?: number
  /** Optional accessible label describing the trend. */
  label?: string
}

/**
 * A tiny line sparkline for the Health Check 4-week trends (proposal 0076).
 * Fixed 0–100 domain so stability / roadmap / support-load trends are visually
 * comparable. No axes, grid, or tooltip — it is a compact directional glyph.
 */
export function TrendSparkline({
  points,
  color = '#60a5fa',
  width = 64,
  height = 24,
  label,
}: TrendSparklineProps) {
  const data = points.map((value, index) => ({ index, value }))

  return (
    <div aria-label={label} role="img" style={{ width, height }}>
      <LineChart width={width} height={height} data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <YAxis type="number" domain={[0, 100]} hide />
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </div>
  )
}
