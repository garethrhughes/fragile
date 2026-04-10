'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useSyncStore } from '@/store/sync-store';

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function latestSync(lastSynced: Record<string, string>): string | null {
  const dates = Object.values(lastSynced).filter(Boolean);
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (a > b ? a : b));
}

export function SyncStatus() {
  const { lastSynced, isSyncing, triggerSync, fetchStatus } = useSyncStore();

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const latest = latestSync(lastSynced);

  return (
    <div className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
      <div className="text-sm text-muted">
        {latest ? (
          <>Last synced: {formatRelativeTime(latest)}</>
        ) : (
          'No sync data available'
        )}
      </div>
      <button
        type="button"
        onClick={() => void triggerSync()}
        disabled={isSyncing}
        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        <RefreshCw
          className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
        />
        {isSyncing ? 'Syncing…' : 'Sync Now'}
      </button>
    </div>
  );
}
