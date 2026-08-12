'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useCallback } from 'react'

/**
 * Returns a `replaceParams` function that merges updates into the current URL
 * search params and calls `router.replace` (no new history entry).
 *
 * Pass `null` as a value to delete that key from the params.
 *
 * The live URL is read at call time (`window.location.search`) rather than from
 * a captured `useSearchParams()` snapshot. Capturing the snapshot made
 * `replaceParams` — and every setter memoised on it — go stale: a control that
 * grabbed a setter at mount (e.g. QuarterSelect's async auto-select) would later
 * merge onto the mount-time URL and clobber any param the user changed in
 * between, making the filters feel frozen when the page loaded with a
 * querystring. Reading live state keeps the merge correct regardless of when the
 * setter was captured, and keeps `replaceParams` referentially stable.
 */
export function useReplaceParams() {
  const router = useRouter()
  const pathname = usePathname()

  return useCallback(
    (updates: Record<string, string | null>) => {
      const current =
        typeof window !== 'undefined' ? window.location.search : ''
      const params = new URLSearchParams(current)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname],
  )
}
