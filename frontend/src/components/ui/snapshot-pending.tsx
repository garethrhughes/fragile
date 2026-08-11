import { Loader2 } from 'lucide-react'

interface SnapshotPendingProps {
  /** Metric noun shown in the message, e.g. "DORA metrics", "cycle time metrics". */
  label: string
  onRetry: () => void
}

/**
 * Shared "snapshot not yet computed" state for time-period metrics that are
 * served from a pre-computed snapshot (DORA, Cycle Time, Support).
 */
export function SnapshotPending({ label, onRetry }: SnapshotPendingProps) {
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-6 py-8 text-center">
      <div className="flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
      <p className="mt-4 text-sm font-semibold text-blue-800">
        Computing {label}&hellip;
      </p>
      <p className="mt-1 text-sm text-blue-700">
        Snapshots are being computed. This usually takes under a minute after
        the first sync.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
      >
        Check again
      </button>
    </div>
  )
}
