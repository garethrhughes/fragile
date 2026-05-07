'use client';

import { useState } from 'react';
import type { EpicCoverageConflictingIdea } from '@/lib/api';

interface EpicConflictBadgeProps {
  conflicts: EpicCoverageConflictingIdea[];
}

/**
 * Inline badge shown next to an epic row when conflictingIdeas.length > 0.
 * Click expands an accessible disclosure listing each conflict with its
 * ideaKey, targetDate, and signed daysFromPrimary so users can copy the
 * idea key and resolve in JPD (proposal 0053 step 3).
 */
export function EpicConflictBadge({ conflicts }: EpicConflictBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${conflicts.length} conflicting roadmap ${
          conflicts.length === 1 ? 'idea' : 'ideas'
        }`}
        className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
      >
        ⚠ {conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicts'}
      </button>
      {expanded && (
        <div
          role="region"
          aria-label="Conflicting ideas"
          className="absolute left-0 top-full z-10 mt-1 w-72 rounded-md border border-gray-200 bg-white p-2 text-xs shadow-md"
        >
          <ul className="space-y-1">
            {conflicts.map((c) => {
              const target = c.targetDate.slice(0, 10);
              const sign = c.daysFromPrimary > 0 ? '+' : '';
              return (
                <li key={c.ideaKey} className="flex justify-between gap-2">
                  <span className="font-mono">{c.ideaKey}</span>
                  <span className="text-gray-600">{target}</span>
                  <span
                    className={
                      c.daysFromPrimary < 0
                        ? 'text-blue-700'
                        : 'text-amber-700'
                    }
                  >
                    {sign}
                    {c.daysFromPrimary}d
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </span>
  );
}
