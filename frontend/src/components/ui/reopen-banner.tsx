'use client'

import { AlertTriangle } from 'lucide-react'

interface ReopenBannerProps {
  /** Count of observations that came from reopen cycles. */
  count: number
}

/**
 * Banner shown on /cycle-time when one or more observations originate
 * from a reopen cycle (proposal 0054 AC F). Hidden when count is 0.
 */
export function ReopenBanner({ count }: ReopenBannerProps) {
  if (count <= 0) return null
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3"
      data-testid="reopen-banner"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
      <p className="text-sm text-blue-700">
        <span className="font-semibold">
          {count} issue{count !== 1 ? 's' : ''} reopened
        </span>{' '}
        — cycle time uses the latest completed cycle for these issues.
      </p>
    </div>
  )
}
