import { create } from 'zustand';
import { triggerSync, getSyncStatus, type SyncStatusItem, type SyncMode } from '@/lib/api';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 180_000;

export interface SyncState {
  /** boardId -> latest sync ISO timestamp */
  lastSynced: Record<string, string>;
  /** boardId -> syncType of the latest sync ('full' | 'incremental') */
  lastSyncType: Record<string, string>;
  isSyncing: boolean;
  triggerSync: (mode?: SyncMode) => Promise<void>;
  fetchStatus: () => Promise<void>;
}

/**
 * Returns true when every board in the pre-trigger snapshot has reported a
 * lastSync timestamp that is strictly newer than the one recorded before the
 * sync was triggered.
 *
 * Three cases handled:
 *  - Board existed before with a timestamp → current timestamp must be newer.
 *  - Board existed before with null (never synced) → any non-null timestamp counts.
 *  - Snapshot is empty (pre-flight fetch failed) → cannot confirm convergence; return false.
 */
function allBoardsUpdated(
  snapshot: Record<string, string | null>,
  current: SyncStatusItem[],
): boolean {
  const entries = Object.entries(snapshot);
  if (entries.length === 0) return false;

  const currentMap = new Map(current.map((b) => [b.boardId, b.lastSync]));

  return entries.every(([boardId, prevLastSync]) => {
    const currentLastSync = currentMap.get(boardId);
    if (!currentLastSync) return false;
    if (prevLastSync === null) return true;
    return new Date(currentLastSync) > new Date(prevLastSync);
  });
}

/**
 * Map a status response into the store's two lookup maps, keyed by boardId.
 * Boards with a null lastSync (never synced) are omitted from both maps.
 */
function mapStatus(items: SyncStatusItem[]): {
  lastSynced: Record<string, string>;
  lastSyncType: Record<string, string>;
} {
  const lastSynced: Record<string, string> = {};
  const lastSyncType: Record<string, string> = {};
  for (const b of items) {
    if (b.lastSync) {
      lastSynced[b.boardId] = b.lastSync;
      if (b.syncType) lastSyncType[b.boardId] = b.syncType;
    }
  }
  return { lastSynced, lastSyncType };
}

/**
 * Derive the single most-recent sync across all boards, with the syncType that
 * produced it, for display as "Last synced: <time> (<type>)". Returns null when
 * no board has ever synced.
 */
export function deriveLatestSync(
  lastSynced: Record<string, string>,
  lastSyncType: Record<string, string>,
): { timestamp: string; syncType: string | null } | null {
  let latestBoard: string | null = null;
  let latestTs: string | null = null;
  for (const [boardId, ts] of Object.entries(lastSynced)) {
    if (ts && (latestTs === null || ts > latestTs)) {
      latestTs = ts;
      latestBoard = boardId;
    }
  }
  if (latestTs === null || latestBoard === null) return null;
  return { timestamp: latestTs, syncType: lastSyncType[latestBoard] ?? null };
}

export const useSyncStore = create<SyncState>((set, get) => ({
  lastSynced: {},
  lastSyncType: {},
  isSyncing: false,

  triggerSync: async (mode: SyncMode = 'full') => {
    // Guard: do not start a second polling loop if one is already running.
    if (get().isSyncing) return;

    // Build a snapshot of timestamps as they stand before the sync starts.
    // Pre-flight GET ensures boards that have never synced appear as null
    // (rather than being absent from lastSynced, which would cause vacuous
    // convergence on an empty snapshot).
    let preTriggerSnapshot: Record<string, string | null> = {};
    try {
      const preStatus = await getSyncStatus();
      for (const b of preStatus ?? []) {
        preTriggerSnapshot[b.boardId] = b.lastSync;
      }
    } catch {
      // Pre-flight failed — fall back to the store's current lastSynced.
      // allBoardsUpdated will handle an empty snapshot gracefully.
      const current = get().lastSynced;
      for (const [boardId, ts] of Object.entries(current)) {
        preTriggerSnapshot[boardId] = ts;
      }
    }

    set({ isSyncing: true });

    try {
      await triggerSync(mode);
    } catch {
      set({ isSyncing: false });
      return;
    }

    // POST returned — sync is running on the backend. Poll until all boards
    // report a timestamp newer than the pre-trigger snapshot.
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stopPolling = (current?: SyncStatusItem[]): void => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (current) {
        set(mapStatus(current));
      }
      set({ isSyncing: false });
    };

    intervalId = setInterval(() => {
      if (Date.now() >= deadline) {
        stopPolling();
        return;
      }

      getSyncStatus()
        .then((status) => {
          if (allBoardsUpdated(preTriggerSnapshot, status ?? [])) {
            stopPolling(status ?? []);
          }
        })
        .catch(() => {
          // Transient poll failure — keep trying until deadline.
        });
    }, POLL_INTERVAL_MS);
  },

  fetchStatus: async () => {
    try {
      const status = await getSyncStatus();
      set(mapStatus(status ?? []));
    } catch {
      // Silently fail on status fetch
    }
  },
}));
