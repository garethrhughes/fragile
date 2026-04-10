'use client';

import { type DoraBand, bandColor } from '@/lib/dora-bands';

interface BandBadgeProps {
  band: DoraBand;
}

export function BandBadge({ band }: BandBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${bandColor(band)}`}
    >
      {band}
    </span>
  );
}
