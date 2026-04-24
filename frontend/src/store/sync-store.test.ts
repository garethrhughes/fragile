/**
 * Unit tests for useSyncStore — polling-based isSyncing state management.
 *
 * Strategy:
 *  - Mock @/lib/api so no real HTTP calls are made.
 *  - Use vi.useFakeTimers() to control setInterval / Date.now() deterministically.
 *  - Assert store state transitions, not implementation details.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { act } from 'react';

/** Drain the microtask queue by yielding control several times. */
async function flushMicrotasks(): Promise<void> {
  // Four rounds of Promise.resolve() are enough to drain the async chains
  // inside triggerSync (pre-flight fetch → POST → setInterval start).
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the store import
// ---------------------------------------------------------------------------

vi.mock('@/lib/api', () => ({
  triggerSync: vi.fn(),
  getSyncStatus: vi.fn(),
}));

import { triggerSync as mockTriggerSync, getSyncStatus as mockGetSyncStatus } from '@/lib/api';
import { useSyncStore } from './sync-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POLL_MS = 5_000;
const TIMEOUT_MS = 180_000;

function makeStatus(
  boards: Array<{ boardId: string; lastSync: string | null }>,
) {
  return boards.map((b) => ({ ...b, status: b.lastSync ? 'success' : 'never' }));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();

  // Reset to a clean store state before each test
  useSyncStore.setState({ lastSynced: {}, isSyncing: false });

  // Default: triggerSync POST succeeds
  (mockTriggerSync as Mock).mockResolvedValue({ message: 'ok' });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSyncStore.triggerSync', () => {
  it('sets isSyncing true immediately after being called', async () => {
    // Initial status — one board, not yet synced
    (mockGetSyncStatus as Mock).mockResolvedValue(
      makeStatus([{ boardId: 'ACC', lastSync: null }]),
    );

    // Start triggerSync. Because the pre-flight GET and POST both resolve via
    // microtasks, isSyncing is set to true synchronously before any await in
    // the store is resolved. Wrapping in act ensures all state updates flush.
    let syncPromise!: Promise<void>;
    await act(async () => {
      syncPromise = useSyncStore.getState().triggerSync();
      // Yield once so the synchronous set({ isSyncing: true }) fires.
      await Promise.resolve();
    });

    expect(useSyncStore.getState().isSyncing).toBe(true);

    // Clean up — advance timers past the deadline so the interval clears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS);
      await flushMicrotasks();
      await syncPromise;
    });
  });

  it('remains syncing while boards have not yet updated', async () => {
    const PRE_SYNC_TS = '2026-04-24T10:00:00.000Z';

    // Pre-trigger: board has an existing timestamp
    useSyncStore.setState({ lastSynced: { ACC: PRE_SYNC_TS } });

    // Both the pre-flight status fetch and subsequent polls return the OLD timestamp
    (mockGetSyncStatus as Mock).mockResolvedValue(
      makeStatus([{ boardId: 'ACC', lastSync: PRE_SYNC_TS }]),
    );

    let syncPromise!: Promise<void>;
    await act(async () => {
      syncPromise = useSyncStore.getState().triggerSync();
      // Yield so the pre-flight fetch + POST complete and isSyncing is set.
      await flushMicrotasks();
    });

    // isSyncing must be true — no poll has fired yet (fake timers).
    expect(useSyncStore.getState().isSyncing).toBe(true);

    // Advance one poll interval — old timestamp returned, still syncing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushMicrotasks();
    });
    expect(useSyncStore.getState().isSyncing).toBe(true);

    // Clean up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS);
      await flushMicrotasks();
      await syncPromise;
    });
  });

  it('clears isSyncing when all boards report a newer timestamp', async () => {
    const PRE_SYNC_TS = '2026-04-24T10:00:00.000Z';
    const POST_SYNC_TS = '2026-04-24T10:01:00.000Z';

    useSyncStore.setState({ lastSynced: { ACC: PRE_SYNC_TS } });

    // Pre-flight: old timestamp
    (mockGetSyncStatus as Mock).mockResolvedValueOnce(
      makeStatus([{ boardId: 'ACC', lastSync: PRE_SYNC_TS }]),
    );

    // Subsequent polls: first still old, then updated
    (mockGetSyncStatus as Mock)
      .mockResolvedValueOnce(makeStatus([{ boardId: 'ACC', lastSync: PRE_SYNC_TS }]))
      .mockResolvedValue(makeStatus([{ boardId: 'ACC', lastSync: POST_SYNC_TS }]));

    await act(async () => {
      void useSyncStore.getState().triggerSync();
      await flushMicrotasks();
    });

    // First poll — old timestamp, still syncing
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushMicrotasks();
    });
    expect(useSyncStore.getState().isSyncing).toBe(true);

    // Second poll — new timestamp, convergence
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushMicrotasks();
    });
    expect(useSyncStore.getState().isSyncing).toBe(false);
    expect(useSyncStore.getState().lastSynced['ACC']).toBe(POST_SYNC_TS);
  });

  it('updates lastSynced on convergence', async () => {
    const PRE_SYNC_TS = '2026-04-24T09:00:00.000Z';
    const POST_SYNC_TS = '2026-04-24T09:30:00.000Z';

    useSyncStore.setState({ lastSynced: { ACC: PRE_SYNC_TS, BPT: PRE_SYNC_TS } });

    (mockGetSyncStatus as Mock).mockResolvedValueOnce(
      makeStatus([
        { boardId: 'ACC', lastSync: PRE_SYNC_TS },
        { boardId: 'BPT', lastSync: PRE_SYNC_TS },
      ]),
    );

    (mockGetSyncStatus as Mock).mockResolvedValue(
      makeStatus([
        { boardId: 'ACC', lastSync: POST_SYNC_TS },
        { boardId: 'BPT', lastSync: POST_SYNC_TS },
      ]),
    );

    await act(async () => {
      void useSyncStore.getState().triggerSync();
      await flushMicrotasks();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushMicrotasks();
    });

    expect(useSyncStore.getState().isSyncing).toBe(false);
    expect(useSyncStore.getState().lastSynced['ACC']).toBe(POST_SYNC_TS);
    expect(useSyncStore.getState().lastSynced['BPT']).toBe(POST_SYNC_TS);
  });

  it('clears isSyncing after the 3-minute safety timeout even if boards never update', async () => {
    const PRE_SYNC_TS = '2026-04-24T08:00:00.000Z';

    useSyncStore.setState({ lastSynced: { ACC: PRE_SYNC_TS } });

    // All calls return the same old timestamp — sync never appears to complete
    (mockGetSyncStatus as Mock).mockResolvedValue(
      makeStatus([{ boardId: 'ACC', lastSync: PRE_SYNC_TS }]),
    );

    await act(async () => {
      void useSyncStore.getState().triggerSync();
      await flushMicrotasks();
    });

    // Advance past the 180-second deadline
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS + POLL_MS);
      await flushMicrotasks();
    });

    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it('does not start a second polling loop if already syncing', async () => {
    const PRE_SYNC_TS = '2026-04-24T07:00:00.000Z';

    useSyncStore.setState({ lastSynced: { ACC: PRE_SYNC_TS } });

    (mockGetSyncStatus as Mock).mockResolvedValue(
      makeStatus([{ boardId: 'ACC', lastSync: PRE_SYNC_TS }]),
    );

    await act(async () => {
      void useSyncStore.getState().triggerSync();
      await flushMicrotasks();
    });

    expect(useSyncStore.getState().isSyncing).toBe(true);

    // Call triggerSync a second time while still syncing
    await act(async () => {
      await useSyncStore.getState().triggerSync();
    });

    // triggerSync POST should have been called exactly once
    expect(mockTriggerSync).toHaveBeenCalledTimes(1);
  });

  it('clears isSyncing immediately if POST /api/sync throws', async () => {
    (mockGetSyncStatus as Mock).mockResolvedValue(
      makeStatus([{ boardId: 'ACC', lastSync: null }]),
    );
    (mockTriggerSync as Mock).mockRejectedValue(new Error('Network error'));

    await act(async () => {
      await useSyncStore.getState().triggerSync();
    });

    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it('handles a board that has never synced — any non-null timestamp satisfies convergence', async () => {
    const FIRST_SYNC_TS = '2026-04-24T06:00:00.000Z';

    // Store has no prior data for ACC
    useSyncStore.setState({ lastSynced: {} });

    (mockGetSyncStatus as Mock).mockResolvedValueOnce(
      // Pre-flight: board exists but has never synced
      makeStatus([{ boardId: 'ACC', lastSync: null }]),
    );

    (mockGetSyncStatus as Mock).mockResolvedValue(
      // Poll: board now has a timestamp
      makeStatus([{ boardId: 'ACC', lastSync: FIRST_SYNC_TS }]),
    );

    await act(async () => {
      void useSyncStore.getState().triggerSync();
      await flushMicrotasks();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flushMicrotasks();
    });

    expect(useSyncStore.getState().isSyncing).toBe(false);
    expect(useSyncStore.getState().lastSynced['ACC']).toBe(FIRST_SYNC_TS);
  });
});

// ---------------------------------------------------------------------------

describe('useSyncStore.fetchStatus', () => {
  it('maps the status response into lastSynced', async () => {
    (mockGetSyncStatus as Mock).mockResolvedValue(
      makeStatus([
        { boardId: 'ACC', lastSync: '2026-04-24T05:00:00.000Z' },
        { boardId: 'BPT', lastSync: null },
      ]),
    );

    await act(async () => {
      await useSyncStore.getState().fetchStatus();
    });

    const { lastSynced } = useSyncStore.getState();
    expect(lastSynced['ACC']).toBe('2026-04-24T05:00:00.000Z');
    expect(lastSynced['BPT']).toBeUndefined(); // null entries are excluded
  });

  it('does not throw when getSyncStatus rejects', async () => {
    (mockGetSyncStatus as Mock).mockRejectedValue(new Error('Network error'));

    await expect(
      act(async () => {
        await useSyncStore.getState().fetchStatus();
      }),
    ).resolves.not.toThrow();
  });
});
