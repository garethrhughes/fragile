'use client'

interface StatusBadgeProps {
  status: string
}

// Maps common Jira status categories to colour classes.
// Unknown statuses get a neutral grey badge.
function statusColour(status: string): string {
  const s = status.toLowerCase()
  if (s === 'done' || s === 'closed' || s === 'released' || s === 'complete' || s === 'completed') {
    return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300'
  }
  if (s === 'in progress' || s === 'in review' || s === 'in development') {
    return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300'
  }
  if (s === 'blocked' || s === 'impediment') {
    return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300'
  }
  if (s === 'to do' || s === 'open' || s === 'backlog') {
    return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800/40 dark:text-gray-300'
  }
  return 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/40 dark:text-gray-400'
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${statusColour(status)}`}
    >
      {status}
    </span>
  )
}
