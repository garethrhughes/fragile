/**
 * snapshot-compute.service.spec.ts
 *
 * Unit tests for SnapshotComputeService.
 * MetricsService is mocked — the service now delegates to it entirely.
 */

import { Repository } from 'typeorm';
import { SnapshotComputeService, ORG_SNAPSHOT_KEY } from './snapshot-compute.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { SupportService } from '../support/support.service.js';
import {
  BoardConfig,
  CycleTimeSnapshot,
  DoraSnapshot,
  JiraSprint,
  SupportSnapshot,
} from '../database/entities/index.js';
import type { OrgDoraResult } from '../metrics/dto/org-dora-response.dto.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSnapshotRepo(): jest.Mocked<Repository<DoraSnapshot>> {
  return {
    upsert: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<Repository<DoraSnapshot>>;
}

function mockCycleTimeSnapshotRepo(): jest.Mocked<Repository<CycleTimeSnapshot>> {
  return {
    upsert: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<Repository<CycleTimeSnapshot>>;
}

function mockSupportSnapshotRepo(): jest.Mocked<Repository<SupportSnapshot>> {
  return {
    upsert: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<Repository<SupportSnapshot>>;
}

function mockBoardConfigRepo(boardIds = ['ACC']): jest.Mocked<Repository<BoardConfig>> {
  return {
    find: jest.fn().mockResolvedValue(boardIds.map((boardId) => ({ boardId }))),
    findOne: jest.fn().mockResolvedValue({ boardType: 'scrum' }),
  } as unknown as jest.Mocked<Repository<BoardConfig>>;
}

function mockSprintRepo(): jest.Mocked<Repository<JiraSprint>> {
  return {
    find: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<Repository<JiraSprint>>;
}

function mockOrgDoraResult(): OrgDoraResult {
  return {
    period: { label: '2026-Q1', start: '2026-01-01T00:00:00.000Z', end: '2026-03-31T23:59:59.999Z', totalDays: 90, elapsedDays: 90, partial: false },
    orgDeploymentFrequency: { totalDeployments: 5, deploymentsPerDay: 0.05, band: 'low', periodDays: 90, contributingBoards: 1 },
    orgLeadTime: { medianDays: 3, p95Days: 10, band: 'high', sampleSize: 10, contributingBoards: 1, anomalyCount: 0 },
    orgChangeFailureRate: { totalDeployments: 5, failureCount: 0, changeFailureRate: 0, band: 'elite', contributingBoards: 1, anyBoardUsingDefaultConfig: false, boardsUsingDefaultConfig: [] },
    orgMttr: { medianHours: 2, band: 'elite', incidentCount: 0, contributingBoards: 0 },
    boardBreakdowns: [],
    anyBoardUsingDefaultConfig: false,
    boardsUsingDefaultConfig: [],
  };
}

type MockedMetrics = jest.Mocked<
  Pick<MetricsService, 'getDoraAggregate' | 'getDoraTrend' | 'getCycleTime' | 'getCycleTimeTrend'>
>;
type MockedSupport = jest.Mocked<Pick<SupportService, 'getSupportSummary'>>;

function makeMockMetricsService(): MockedMetrics {
  return {
    getDoraAggregate: jest.fn().mockResolvedValue(mockOrgDoraResult()),
    getDoraTrend: jest.fn().mockResolvedValue([]),
    getCycleTime: jest.fn().mockResolvedValue([]),
    getCycleTimeTrend: jest.fn().mockResolvedValue([]),
  };
}

function makeMockSupportService(): MockedSupport {
  return {
    getSupportSummary: jest.fn().mockResolvedValue({
      totalIssues: 0, supportIssues: 0, supportPercentage: 0,
      p50Days: 0, p95Days: 0, reopenedIssueCount: 0, byBoard: [],
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SnapshotComputeService', () => {
  let service: SnapshotComputeService;
  let snapshotRepo: jest.Mocked<Repository<DoraSnapshot>>;
  let cycleTimeSnapshotRepo: jest.Mocked<Repository<CycleTimeSnapshot>>;
  let supportSnapshotRepo: jest.Mocked<Repository<SupportSnapshot>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let metricsService: MockedMetrics;
  let supportService: MockedSupport;

  beforeEach(() => {
    snapshotRepo          = mockSnapshotRepo();
    cycleTimeSnapshotRepo = mockCycleTimeSnapshotRepo();
    supportSnapshotRepo   = mockSupportSnapshotRepo();
    boardConfigRepo       = mockBoardConfigRepo(['ACC', 'BPT']);
    metricsService        = makeMockMetricsService();
    supportService        = makeMockSupportService();

    service = new SnapshotComputeService(
      metricsService as unknown as MetricsService,
      supportService as unknown as SupportService,
      snapshotRepo,
      cycleTimeSnapshotRepo,
      supportSnapshotRepo,
      boardConfigRepo,
      mockSprintRepo(),
    );
  });

  it('calls getDoraAggregate for the requested board', async () => {
    await service.computeAndPersist('ACC');
    expect(metricsService.getDoraAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'ACC' }),
    );
  });

  it('calls getDoraTrend for the requested board', async () => {
    await service.computeAndPersist('ACC');
    expect(metricsService.getDoraTrend).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'ACC' }),
    );
  });

  it('includes the DORA time-period aggregate + trend rows for each window', async () => {
    await service.computeBoard('ACC');
    const allRows = (snapshotRepo.upsert.mock.calls as [Array<{ boardId: string; snapshotType: string }>, string[]][])
      .flatMap(([rows]) => rows);
    const perBoard = allRows.filter((r) => r.boardId === 'ACC').map((r) => r.snapshotType).sort();
    expect(perBoard).toEqual([
      'aggregate',
      'aggregate-30d',
      'aggregate-7d',
      'aggregate-90d',
      'trend',
      'trend-30d',
      'trend-7d',
      'trend-90d',
      'trend-display',
      'trend-sprint',
    ]);
  });

  it('writes cycle-time snapshots per board: 3 windows (aggregate+trend), current-quarter aggregate, and trend-quarters', async () => {
    await service.computeBoard('ACC');
    const ctRows = (cycleTimeSnapshotRepo.upsert.mock.calls as [Array<{ boardId: string; snapshotType: string }>, string[]][])
      .flatMap(([rows]) => rows);
    const types = ctRows.map((r) => r.snapshotType);
    // Window rows (proposal 0079).
    for (const t of ['aggregate-7d', 'aggregate-30d', 'aggregate-90d', 'trend-7d', 'trend-30d', 'trend-90d']) {
      expect(types).toContain(t);
    }
    // Quarter rows (proposal 0082): the quarter-trend + exactly one current-quarter aggregate.
    // No historical quarters here (sprint repo mock returns none).
    expect(types).toContain('trend-quarters');
    expect(types.filter((t) => /^aggregate-\d{4}-Q[1-4]$/.test(t))).toHaveLength(1);

    // Regression: the quarter aggregate payload is a CycleTimeResult[] (array),
    // matching the live endpoint and the window snapshots. The pre-0084 Lambda
    // stored a bare object here, breaking the frontend's results.flatMap(...);
    // there is now one code path (getCycleTime → array) so drift is impossible.
    const quarterAgg = (
      cycleTimeSnapshotRepo.upsert.mock.calls as [Array<{ snapshotType: string; payload: unknown }>, string[]][]
    )
      .flatMap(([rows]) => rows)
      .find((r) => /^aggregate-\d{4}-Q[1-4]$/.test(r.snapshotType));
    expect(Array.isArray(quarterAgg?.payload)).toBe(true);
  });

  it('writes org-level cycle-time snapshots under __org__ (windows + current quarter + trend-quarters)', async () => {
    await service.computeOrg();
    const ctRows = (cycleTimeSnapshotRepo.upsert.mock.calls as [Array<{ boardId: string; snapshotType: string }>, string[]][])
      .flatMap(([rows]) => rows);
    expect(ctRows.every((r) => r.boardId === ORG_SNAPSHOT_KEY)).toBe(true);
    // 6 window rows + 1 current-quarter aggregate + 1 trend-quarters = 8.
    expect(ctRows).toHaveLength(8);
  });

  it('writes support summary snapshots per board: 3 windows + current quarter', async () => {
    await service.computeBoard('ACC');
    const supRows = (supportSnapshotRepo.upsert.mock.calls as [Array<{ boardId: string; snapshotType: string }>, string[]][])
      .flatMap(([rows]) => rows);
    const types = supRows.map((r) => r.snapshotType);
    for (const t of ['summary-7d', 'summary-30d', 'summary-90d']) {
      expect(types).toContain(t);
    }
    // Exactly one current-quarter summary (no historical quarters in this mock).
    expect(types.filter((t) => /^summary-\d{4}-Q[1-4]$/.test(t))).toHaveLength(1);
    expect(supRows.every((r) => r.boardId === 'ACC')).toBe(true);
    expect(supportService.getSupportSummary).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 'ACC', window: 7 }),
    );
  });

  it('writes org-level support summary snapshots under __org__ (windows + current quarter)', async () => {
    await service.computeOrg();
    const supRows = (supportSnapshotRepo.upsert.mock.calls as [Array<{ boardId: string; snapshotType: string }>, string[]][])
      .flatMap(([rows]) => rows);
    expect(supRows.every((r) => r.boardId === ORG_SNAPSHOT_KEY)).toBe(true);
    // 3 window rows + 1 current-quarter summary = 4.
    expect(supRows).toHaveLength(4);
  });

  it('omits trend-sprint snapshot for Kanban boards', async () => {
    boardConfigRepo.findOne = jest.fn().mockResolvedValue({ boardType: 'kanban' });
    await service.computeBoard('PLAT');

    const allRows = (snapshotRepo.upsert.mock.calls as [Array<{ boardId: string; snapshotType: string }>, string[]][])
      .flatMap(([rows]) => rows);

    const perBoard = allRows.filter((r) => r.boardId === 'PLAT');
    expect(perBoard.find((r) => r.snapshotType === 'trend-sprint')).toBeUndefined();
  });

  it('stores the OrgDoraResult payload for the quarter aggregate snapshot', async () => {
    const aggregate = mockOrgDoraResult();
    metricsService.getDoraAggregate.mockResolvedValue(aggregate);

    await service.computeAndPersist('ACC');

    const allRows = (snapshotRepo.upsert.mock.calls as [Array<{ snapshotType: string; payload: unknown }>, string[]][])
      .flatMap(([rows]) => rows);
    const aggregateRow = allRows.find((r) => r.snapshotType === 'aggregate');
    expect(aggregateRow?.payload).toBe(aggregate);
  });

  it('rethrows errors so SyncService can log them', async () => {
    metricsService.getDoraAggregate.mockRejectedValue(new Error('query failed'));
    await expect(service.computeAndPersist('ACC')).rejects.toThrow('query failed');
  });
});
