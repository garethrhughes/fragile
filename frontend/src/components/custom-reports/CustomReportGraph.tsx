'use client'

import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  AreaChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { CustomReportDataPoint, CustomReportWidget } from '@/lib/api'

// Deterministic palette — same order as existing chart colours in the codebase
const SERIES_COLOURS = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
]

interface Props {
  graph: CustomReportWidget
  filteredPoints: CustomReportDataPoint[]
}

type ChartDatum = Record<string, string | number>

function buildChartData(
  points: CustomReportDataPoint[],
  seriesKey: string | null,
): { data: ChartDatum[]; seriesNames: string[] } {
  if (!seriesKey) {
    // No series splitting — treat all points as a single "_value" series
    const data = points.map((p) => ({ x: p.x, _value: p.y }))
    return { data, seriesNames: ['_value'] }
  }

  // Group by x, spread series values across columns
  const seriesSet = new Set<string>()
  const byX = new Map<string, ChartDatum>()

  for (const p of points) {
    const seriesLabel = p.series ?? (p.dimensions?.[seriesKey] ?? 'default')
    seriesSet.add(seriesLabel)
    const row = byX.get(p.x) ?? { x: p.x }
    row[seriesLabel] = p.y
    byX.set(p.x, row)
  }

  const data = Array.from(byX.values()).sort((a, b) =>
    String(a.x).localeCompare(String(b.x)),
  )
  return { data, seriesNames: Array.from(seriesSet) }
}

export function CustomReportGraph({ graph, filteredPoints }: Props) {
  const { data, seriesNames } = buildChartData(filteredPoints, graph.seriesKey)

  const commonProps = {
    data,
    margin: { top: 8, right: 24, left: 0, bottom: 0 },
  }

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
      <XAxis
        dataKey="x"
        tick={{ fontSize: 12 }}
        label={
          graph.xAxisLabel
            ? { value: graph.xAxisLabel, position: 'insideBottom', offset: -4, fontSize: 12 }
            : undefined
        }
      />
      <YAxis
        tick={{ fontSize: 12 }}
        label={
          graph.yAxisLabel
            ? { value: graph.yAxisLabel, angle: -90, position: 'insideLeft', fontSize: 12 }
            : undefined
        }
      />
      <Tooltip />
      {seriesNames.length > 1 && <Legend />}
    </>
  )

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-4 text-sm font-semibold">{graph.title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        {graph.kind === 'bar' ? (
          <BarChart {...commonProps}>
            {axes}
            {seriesNames.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                name={s === '_value' ? graph.yAxisLabel ?? 'Value' : s}
                fill={SERIES_COLOURS[i % SERIES_COLOURS.length]}
              />
            ))}
          </BarChart>
        ) : graph.kind === 'area' ? (
          <AreaChart {...commonProps}>
            {axes}
            {seriesNames.map((s, i) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                name={s === '_value' ? graph.yAxisLabel ?? 'Value' : s}
                stroke={SERIES_COLOURS[i % SERIES_COLOURS.length]}
                fill={SERIES_COLOURS[i % SERIES_COLOURS.length]}
                fillOpacity={0.15}
              />
            ))}
          </AreaChart>
        ) : (
          // default: line
          <LineChart {...commonProps}>
            {axes}
            {seriesNames.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                name={s === '_value' ? graph.yAxisLabel ?? 'Value' : s}
                stroke={SERIES_COLOURS[i % SERIES_COLOURS.length]}
                dot={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
