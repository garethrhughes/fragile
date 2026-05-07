'use client';

import { useEffect, useState } from 'react';
import {
  getRoadmapEpics,
  type EpicCoverageDetail,
  type EpicCoverageState,
} from '@/lib/api';
import { EpicConflictBadge } from './epic-conflict-badge';

interface EpicDetailPanelProps {
  boardId: string;
  sprintId: string;
  sprintName: string;
}

const stateClass: Record<EpicCoverageState, string> = {
  green: 'bg-green-100 text-green-800',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-800',
  unlinked: 'bg-gray-100 text-gray-700',
};

/**
 * Per-epic detail panel for a single sprint — proposal 0053 step 3.
 * Lazy-fetches `/api/roadmap/epics` when first mounted (or when sprintId
 * changes) and renders a compact list of epics with primaryIdea target,
 * coverageState, resolvedSource, and an inline `EpicConflictBadge`.
 */
export function EpicDetailPanel({
  boardId,
  sprintId,
  sprintName,
}: EpicDetailPanelProps) {
  const [data, setData] = useState<EpicCoverageDetail[] | null>(null);
  const [conflictCount, setConflictCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRoadmapEpics({ boardId, sprintId })
      .then((res) => {
        if (cancelled) return;
        setData(res.epics);
        setConflictCount(res.conflictCount);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load epic detail');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId, sprintId]);

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Epic detail — {sprintName}
        </h3>
        {conflictCount > 0 && (
          <span className="text-xs text-amber-700">
            {conflictCount} idea conflict{conflictCount === 1 ? '' : 's'} across epics
          </span>
        )}
      </div>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && data && data.length === 0 && (
        <p className="text-sm text-gray-500">No epics in this sprint.</p>
      )}
      {!loading && !error && data && data.length > 0 && (
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-3">Epic</th>
              <th className="py-2 pr-3">Primary idea</th>
              <th className="py-2 pr-3">Target</th>
              <th className="py-2 pr-3">Source</th>
              <th className="py-2 pr-3">State</th>
              <th className="py-2">Conflicts</th>
            </tr>
          </thead>
          <tbody>
            {data.map((epic) => (
              <tr key={epic.epicKey} className="border-b border-gray-100">
                <td className="py-2 pr-3 font-mono text-xs">
                  {epic.epicKey}
                  {epic.epicSummary && (
                    <span className="ml-2 text-gray-500">{epic.epicSummary}</span>
                  )}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {epic.primaryIdea?.ideaKey ?? '—'}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-700">
                  {epic.primaryIdea?.targetDate?.slice(0, 10) ?? '—'}
                </td>
                <td className="py-2 pr-3 text-xs text-gray-600">
                  {epic.resolvedSource}
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${stateClass[epic.coverageState]}`}
                  >
                    {epic.coverageState}
                  </span>
                </td>
                <td className="py-2">
                  <EpicConflictBadge conflicts={epic.conflictingIdeas} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
