'use client'

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface SupportDistributionChartProps {
  supportIssues: number
  totalIssues: number
}

const COLORS = ['#f97316', '#94a3b8'] // orange for support, slate for other

export function SupportDistributionChart({
  supportIssues,
  totalIssues,
}: SupportDistributionChartProps) {
  const other = totalIssues - supportIssues
  const data = [
    { name: 'Support', value: supportIssues },
    { name: 'Other', value: other },
  ]

  if (totalIssues === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted">
        No data
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number, name: string) => [
            `${value} issues`,
            name,
          ]}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}
