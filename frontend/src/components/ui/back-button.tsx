'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

interface BackButtonProps {
  /** Label text shown next to the chevron icon */
  label: string
  /** Href to navigate to if there is no browser history to go back to */
  fallbackHref: string
}

/**
 * A "← Back" button that calls `router.back()` when there is history to
 * return to, or navigates to `fallbackHref` when the page was opened
 * directly (e.g. from a bookmark or shared link).
 */
export function BackButton({ label, fallbackHref }: BackButtonProps) {
  const router = useRouter()

  function handleClick() {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </button>
  )
}
