'use client'

/**
 * HealthcheckTrendChart — Recharts line chart plotting the three Healthcheck
 * scores (Stability, Roadmap, Support) across the trailing 8 weeks.
 *
 * N/A weeks (null scores) render as gaps via `connectNulls={false}` (mirrors
 * the sprint-report composite-score trend, ADR 0053 pattern).
 */
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import type {
  ValueType,
  NameType,
} from 'recharts/types/component/DefaultTooltipContent'
import { formatWeekLabel } from '@/lib/iso-week'
import type { HealthcheckTrendPoint } from '@/lib/api'

interface HealthcheckTrendChartProps {
  trend: HealthcheckTrendPoint[]
}

const SERIES = [
  { key: 'stability', name: 'Stability', stroke: '#6366f1' },
  { key: 'roadmap', name: 'Roadmap', stroke: '#10b981' },
  { key: 'support', name: 'Support', stroke: '#f59e0b' },
] as const

export function HealthcheckTrendChart({ trend }: HealthcheckTrendChartProps) {
  const data = trend.map((p) => ({
    label: formatWeekLabel(p.week),
    stability: p.stability,
    roadmap: p.roadmap,
    support: p.support,
  }))

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">8-Week Trend</h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => String(v)}
          />
          <Tooltip
            formatter={(
              value: ValueType | undefined,
              name: NameType | undefined,
            ): [string, string] => [
              value === null || value === undefined || Array.isArray(value)
                ? 'N/A'
                : `${Number(value).toFixed(1)}%`,
              String(name ?? ''),
            ]}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.stroke}
              strokeWidth={2}
              dot={{ r: 3, fill: s.stroke }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
