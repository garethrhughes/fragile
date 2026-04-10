'use client';

import { type DoraBand } from '@/lib/dora-bands';
import { BandBadge } from './band-badge';

// ---------------------------------------------------------------------------
// Sparkline – tiny SVG line chart for trend data
// ---------------------------------------------------------------------------

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;

  const width = 80;
  const height = 24;
  const padding = 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block"
      aria-label="Trend sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

interface MetricCardProps {
  title: string;
  value: number;
  unit: string;
  band: DoraBand;
  trend?: number[];
}

function formatValue(value: number, unit: string): string {
  if (unit === '%') return `${value.toFixed(1)}%`;
  if (unit === 'deploys/day') return value.toFixed(2);
  if (unit === 'days' || unit === 'hours') return value.toFixed(1);
  return String(value);
}

export function MetricCard({ title, value, unit, band, trend }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium text-muted">{title}</h3>
        <BandBadge band={band} />
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className="text-3xl font-bold tracking-tight">
          {formatValue(value, unit)}
        </span>
        {unit !== '%' && (
          <span className="mb-1 text-sm text-muted">{unit}</span>
        )}
      </div>

      {trend && trend.length >= 2 && (
        <div className="mt-3">
          <Sparkline data={trend} />
        </div>
      )}
    </div>
  );
}
