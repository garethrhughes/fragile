/**
 * PriorityBadge — renders a Jira-style priority indicator.
 *
 * Colour mapping follows Jira Cloud's standard priority palette:
 *   Highest  →  red
 *   High     →  orange
 *   Medium   →  yellow
 *   Low      →  blue
 *   Lowest   →  grey
 *
 * Any unrecognised value is rendered with a neutral grey dot.
 */

interface PriorityBadgeProps {
  priority: string | null | undefined
}

type PriorityConfig = {
  dot: string
  label: string
}

const PRIORITY_MAP: Record<string, PriorityConfig> = {
  highest: { dot: 'bg-red-500',    label: 'text-red-700'    },
  high:    { dot: 'bg-orange-500', label: 'text-orange-700' },
  medium:  { dot: 'bg-yellow-400', label: 'text-yellow-700' },
  low:     { dot: 'bg-blue-400',   label: 'text-blue-700'   },
  lowest:  { dot: 'bg-gray-400',   label: 'text-gray-600'   },
}

const FALLBACK: PriorityConfig = { dot: 'bg-gray-300', label: 'text-gray-500' }

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  if (!priority) return <span className="text-muted">—</span>

  const config = PRIORITY_MAP[priority.toLowerCase()] ?? FALLBACK

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${config.label}`}>
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${config.dot}`} />
      {priority}
    </span>
  )
}
