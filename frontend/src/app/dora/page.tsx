'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type { ValueType, NameType } from 'recharts/types/component/DefaultTooltipContent';
import {
  getDoraMetrics,
  getSprints,
  getQuarters,
  type MetricResult,
  type SprintInfo,
  type QuarterInfo,
  type DoraMetricsBoard,
} from '@/lib/api';
import { useFilterStore, ALL_BOARDS } from '@/store/filter-store';
import { MetricCard } from '@/components/ui/metric-card';
import { BoardChip } from '@/components/ui/board-chip';
import { EmptyState } from '@/components/ui/empty-state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AggregatedMetrics {
  deploymentFrequency: MetricResult;
  leadTime: MetricResult;
  cfr: MetricResult;
  mttr: MetricResult;
}

interface TimeSeriesPoint {
  label: string
  deploymentFrequency: number
  leadTime: number
  changeFailureRate: number
  mttr: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BoardMetrics {
  boardId: string;
  deploymentFrequency: MetricResult;
  leadTime: MetricResult;
  cfr: MetricResult;
  mttr: MetricResult;
}

function mapBoardMetrics(board: DoraMetricsBoard): BoardMetrics {
  return {
    boardId: board.boardId,
    deploymentFrequency: {
      value: board.deploymentFrequency.deploymentsPerDay,
      unit: 'deploys/day',
      band: board.deploymentFrequency.band,
    },
    leadTime: {
      value: board.leadTime.medianDays,
      unit: 'days',
      band: board.leadTime.band,
    },
    cfr: {
      value: board.changeFailureRate.changeFailureRate,
      unit: '%',
      band: board.changeFailureRate.band,
    },
    mttr: {
      value: board.mttr.medianHours,
      unit: 'hours',
      band: board.mttr.band,
    },
  };
}

function computeAggregateMetrics(boards: BoardMetrics[]): AggregatedMetrics | null {
  if (boards.length === 0) return null;

  if (boards.length === 1) {
    return {
      deploymentFrequency: boards[0].deploymentFrequency,
      leadTime: boards[0].leadTime,
      cfr: boards[0].cfr,
      mttr: boards[0].mttr,
    };
  }

  const count = boards.length;
  const sum = (extractor: (b: BoardMetrics) => MetricResult): MetricResult => {
    const values = boards.map((b) => extractor(b));
    const avgValue = values.reduce((s, v) => s + v.value, 0) / count;

    // Take the worst band
    const bandOrder: Record<string, number> = { elite: 3, high: 2, medium: 1, low: 0 };
    const worstBand = values.reduce(
      (worst, v) => (bandOrder[v.band] < bandOrder[worst.band] ? v : worst),
      values[0],
    );

    // Merge trends – average per period
    const trendLengths = values.map((v) => v.trend?.length ?? 0);
    const maxTrendLen = Math.max(...trendLengths);
    let trend: number[] | undefined;
    if (maxTrendLen > 0) {
      trend = Array.from({ length: maxTrendLen }, (_, i) => {
        const validValues = values
          .map((v) => v.trend?.[i])
          .filter((t): t is number => t !== undefined);
        return validValues.length > 0
          ? validValues.reduce((s, v) => s + v, 0) / validValues.length
          : 0;
      });
    }

    return {
      value: avgValue,
      unit: values[0].unit,
      band: worstBand.band,
      trend,
    };
  };

  return {
    deploymentFrequency: sum((m) => m.deploymentFrequency),
    leadTime: sum((m) => m.leadTime),
    cfr: sum((m) => m.cfr),
    mttr: sum((m) => m.mttr),
  };
}

function abbreviateLabel(name: string): string {
  // "2025-Q1" → "Q1 '25"
  const qMatch = name.match(/^(\d{4})-Q([1-4])$/);
  if (qMatch) {
    return `Q${qMatch[2]} '${qMatch[1].slice(2)}`;
  }
  // "Sprint 42" / "ACC Sprint 42 (Jan 2025)" → "SP 42"
  const numMatch = name.match(/(\d+)/);
  if (numMatch) {
    return `SP ${numMatch[1]}`;
  }
  return name.length > 8 ? name.slice(0, 8) : name;
}

// Convert a raw API response array + the board-aggregation helpers into a
// single TimeSeriesPoint for one period.
function buildTimeSeriesPoint(
  label: string,
  res: DoraMetricsBoard[],
): TimeSeriesPoint {
  const mapped = res.map(mapBoardMetrics);
  const agg = computeAggregateMetrics(mapped);
  return {
    label,
    deploymentFrequency: agg?.deploymentFrequency.value ?? 0,
    leadTime: agg?.leadTime.value ?? 0,
    changeFailureRate: agg?.cfr.value ?? 0,
    mttr: agg?.mttr.value ?? 0,
  };
}

// ---------------------------------------------------------------------------
// TrendChart
// ---------------------------------------------------------------------------

interface TrendChartProps {
  title: string
  data: TimeSeriesPoint[]
  dataKey: keyof Omit<TimeSeriesPoint, 'label'>
  unit: string
  color: string
}

function TrendChart({ title, data, dataKey, unit, color }: TrendChartProps) {
  if (data.length < 2) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl border border-border bg-card p-4">
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-muted">Not enough data</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={data}
          margin={{ top: 4, right: 12, left: -16, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}${unit}`}
          />
          <Tooltip
            formatter={(value: ValueType | undefined, name: NameType | undefined): [string, string] => [
              value !== undefined && !Array.isArray(value) ? `${Number(value).toFixed(2)}${unit}` : '',
              String(name ?? title),
            ]}
            contentStyle={{ fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3, fill: color }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DoraPage() {
  const {
    selectedBoards,
    periodType,
    setSelectedBoards,
    setPeriodType,
  } = useFilterStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aggregateMetrics, setAggregateMetrics] = useState<AggregatedMetrics | null>(null);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesPoint[]>([]);
  // True when at least one selected board has no BoardConfig row — CFR values
  // are based on default issue-type/label filters and may not reflect reality.
  const [cfrUsingDefaults, setCfrUsingDefaults] = useState(false);

  const toggleBoard = useCallback(
    (boardId: string) => {
      setSelectedBoards(
        selectedBoards.includes(boardId)
          ? selectedBoards.filter((b) => b !== boardId)
          : [...selectedBoards, boardId],
      );
    },
    [selectedBoards, setSelectedBoards],
  );

  const firstBoard = useMemo(
    () => (selectedBoards.length > 0 ? selectedBoards[0] : null),
    [selectedBoards],
  );

  // Fetch all periods and build time-series data
  useEffect(() => {
    if (selectedBoards.length === 0 || !firstBoard) {
      setAggregateMetrics(null);
      setTimeSeriesData([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const boardId = selectedBoards.join(',');

    const load = async (): Promise<void> => {
      if (periodType === 'sprint') {
        const sprints: SprintInfo[] = await getSprints(firstBoard);
        // Filter out future sprints; order is already active-first, closed DESC
        const nonFuture = sprints.filter((s) => s.state !== 'future');
        if (nonFuture.length === 0) {
          setAggregateMetrics(null);
          setTimeSeriesData([]);
          return;
        }

        // Fetch all in parallel
        const results = await Promise.all(
          nonFuture.map((sprint) =>
            getDoraMetrics({ boardId, sprintId: sprint.id }),
          ),
        );

        if (cancelled) return;

        // Most recent sprint = index 0 (active or most-recent closed)
        const recentMapped = results[0].map(mapBoardMetrics);
        setAggregateMetrics(computeAggregateMetrics(recentMapped));
        setCfrUsingDefaults(results[0].some((b) => b.changeFailureRate.usingDefaultConfig));

        // Build time series oldest→newest (reverse of the nonFuture order)
        const points: TimeSeriesPoint[] = nonFuture
          .map((sprint, i) => buildTimeSeriesPoint(abbreviateLabel(sprint.name), results[i]))
          .reverse();
        setTimeSeriesData(points);
      } else {
        // quarter mode
        const quarters: QuarterInfo[] = await getQuarters();
        if (quarters.length === 0) {
          setAggregateMetrics(null);
          setTimeSeriesData([]);
          return;
        }

        // Sort: newest first (API may or may not guarantee order)
        const sorted = [...quarters].sort((a, b) =>
          b.quarter.localeCompare(a.quarter),
        );

        const results = await Promise.all(
          sorted.map((q) => getDoraMetrics({ boardId, quarter: q.quarter })),
        );

        if (cancelled) return;

        // Most recent = index 0
        const recentMapped = results[0].map(mapBoardMetrics);
        setAggregateMetrics(computeAggregateMetrics(recentMapped));
        setCfrUsingDefaults(results[0].some((b) => b.changeFailureRate.usingDefaultConfig));

        // Build time series oldest→newest
        const points: TimeSeriesPoint[] = sorted
          .map((q, i) => buildTimeSeriesPoint(abbreviateLabel(q.quarter), results[i]))
          .reverse();
        setTimeSeriesData(points);
      }
    };

    load()
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load metrics');
          setAggregateMetrics(null);
          setTimeSeriesData([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBoards, periodType, firstBoard]);

  // Trend arrays extracted from time-series (oldest→newest = chart order)
  const dfTrend = useMemo(
    () => timeSeriesData.map((p) => p.deploymentFrequency),
    [timeSeriesData],
  );
  const ltTrend = useMemo(
    () => timeSeriesData.map((p) => p.leadTime),
    [timeSeriesData],
  );
  const cfrTrend = useMemo(
    () => timeSeriesData.map((p) => p.changeFailureRate),
    [timeSeriesData],
  );
  const mttrTrend = useMemo(
    () => timeSeriesData.map((p) => p.mttr),
    [timeSeriesData],
  );

  const hasData = aggregateMetrics !== null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">DORA Metrics</h1>
        <p className="mt-1 text-sm text-muted">
          Four key metrics for software delivery performance
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        {/* Board selector */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">
            Boards
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_BOARDS.map((boardId) => (
              <BoardChip
                key={boardId}
                boardId={boardId}
                selected={selectedBoards.includes(boardId)}
                onClick={() => toggleBoard(boardId)}
              />
            ))}
          </div>
        </div>

        {/* Period type toggle — no selector dropdowns */}
        <div>
          <label className="mb-2 block text-sm font-medium text-muted">
            Period
          </label>
          <div className="inline-flex rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setPeriodType('sprint')}
              className={`rounded-l-lg px-4 py-2 text-sm font-medium transition-colors ${
                periodType === 'sprint'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-muted hover:bg-gray-50'
              }`}
            >
              Sprint
            </button>
            <button
              type="button"
              onClick={() => setPeriodType('quarter')}
              className={`rounded-r-lg px-4 py-2 text-sm font-medium transition-colors ${
                periodType === 'quarter'
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-muted hover:bg-gray-50'
              }`}
            >
              Quarter
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !hasData && (
        <EmptyState
          title="No metrics yet"
          message="Select one or more boards to view DORA metrics."
        />
      )}

      {/* Metric cards — show most recent period's aggregate */}
      {!loading && hasData && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              title="Deployment Frequency"
              value={aggregateMetrics!.deploymentFrequency.value}
              unit={aggregateMetrics!.deploymentFrequency.unit}
              band={aggregateMetrics!.deploymentFrequency.band}
              trend={dfTrend}
            />
            <MetricCard
              title="Lead Time for Changes"
              value={aggregateMetrics!.leadTime.value}
              unit={aggregateMetrics!.leadTime.unit}
              band={aggregateMetrics!.leadTime.band}
              trend={ltTrend}
            />
            <MetricCard
              title="Change Failure Rate"
              value={aggregateMetrics!.cfr.value}
              unit={aggregateMetrics!.cfr.unit}
              band={aggregateMetrics!.cfr.band}
              trend={cfrTrend}
            />
            {cfrUsingDefaults && (
              <p className="col-span-full -mt-2 text-xs text-amber-600">
                CFR is using default failure filters (Bug / Incident issue types). Configure board settings to refine this metric.
              </p>
            )}
            <MetricCard
              title="Mean Time to Recovery"
              value={aggregateMetrics!.mttr.value}
              unit={aggregateMetrics!.mttr.unit}
              band={aggregateMetrics!.mttr.band}
              trend={mttrTrend}
            />
          </div>

          {/* Trend charts — 2×2 grid on large screens */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TrendChart
              title="Deployment Frequency"
              data={timeSeriesData}
              dataKey="deploymentFrequency"
              unit=" dep/d"
              color="#3b82f6"
            />
            <TrendChart
              title="Lead Time for Changes"
              data={timeSeriesData}
              dataKey="leadTime"
              unit=" days"
              color="#8b5cf6"
            />
            <TrendChart
              title="Change Failure Rate"
              data={timeSeriesData}
              dataKey="changeFailureRate"
              unit="%"
              color="#ef4444"
            />
            <TrendChart
              title="Mean Time to Recovery"
              data={timeSeriesData}
              dataKey="mttr"
              unit=" hrs"
              color="#f59e0b"
            />
          </div>
        </>
      )}
    </div>
  );
}
