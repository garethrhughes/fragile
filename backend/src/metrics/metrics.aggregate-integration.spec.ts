/**
 * metrics.aggregate-integration.spec.ts
 *
 * Integration test: mounts the real MetricsController + real MetricsService
 * (with mocked sub-services and mocked DoraSnapshotReadService) to verify
 * the full controller→service→period-resolution chain.
 *
 * Acceptance criterion from proposal 0059:
 *   "Integration test: request with quarter in the past returns period matching
 *    that quarter (period.start, period.end, period.partial)."
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { DeploymentFrequencyService } from './deployment-frequency.service.js';
import { LeadTimeService } from './lead-time.service.js';
import { CfrService } from './cfr.service.js';
import { MttrService } from './mttr.service.js';
import { CycleTimeService } from './cycle-time.service.js';
import { DoraCacheService } from './dora-cache.service.js';
import { TrendDataLoader } from './trend-data-loader.service.js';
import { DoraSnapshotReadService } from './dora-snapshot-read.service.js';
import { BoardConfig, JiraSprint } from '../database/entities/index.js';
import type { OrgDoraResult } from './dto/org-dora-response.dto.js';
import type { DoraAggregateQueryDto } from './dto/dora-aggregate-query.dto.js';

// ---------------------------------------------------------------------------
// Minimal mock factories — return just enough for the paths exercised.
// ---------------------------------------------------------------------------

const stubDf = {
  calculate: jest.fn().mockResolvedValue({ boardId: 'ACC', totalDeployments: 2, deploymentsPerDay: 0.02, band: 'low', periodDays: 92 }),
  calculateFromData: jest.fn().mockReturnValue({ boardId: 'ACC', totalDeployments: 2, deploymentsPerDay: 0.02, band: 'low', periodDays: 92 }),
};

const stubLt = {
  calculate: jest.fn().mockResolvedValue({ boardId: 'ACC', medianDays: 5, p95Days: 10, band: 'high', sampleSize: 2, anomalyCount: 0 }),
  getLeadTimeObservations: jest.fn().mockResolvedValue({ observations: [5, 8], anomalyCount: 0 }),
  getLeadTimeObservationsFromData: jest.fn().mockReturnValue({ observations: [5, 8], anomalyCount: 0 }),
};

const stubCfr = {
  calculate: jest.fn().mockResolvedValue({ boardId: 'ACC', totalDeployments: 2, failureCount: 0, changeFailureRate: 0, band: 'elite', usingDefaultConfig: false }),
  calculateFromData: jest.fn().mockReturnValue({ boardId: 'ACC', totalDeployments: 2, failureCount: 0, changeFailureRate: 0, band: 'elite', usingDefaultConfig: false }),
};

const stubMttr = {
  calculate: jest.fn().mockResolvedValue({ boardId: 'ACC', medianHours: 1, band: 'elite', incidentCount: 0, openIncidentCount: 0, anomalyCount: 0 }),
  getMttrObservations: jest.fn().mockResolvedValue({ recoveryHours: [], openIncidentCount: 0, anomalyCount: 0 }),
  getMttrObservationsFromData: jest.fn().mockReturnValue({ recoveryHours: [], openIncidentCount: 0, anomalyCount: 0 }),
};

const stubCycleTime = {
  calculate: jest.fn().mockResolvedValue({ boardId: 'ACC', count: 0, anomalyCount: 0, p50Days: 0, p85Days: 0, band: null, observations: [] }),
  getCycleTimeObservations: jest.fn().mockResolvedValue({ observations: [] }),
};

const stubTrendLoader = {
  load: jest.fn().mockResolvedValue({ boardId: 'ACC', boardConfig: null, wtEntity: null, issues: [], changelogs: [], versions: [], issueLinks: [] }),
};

// Snapshot service — returns null so the controller responds 202/pending for
// current-quarter requests (snapshot absent). Historical-quarter requests bypass
// the snapshot path entirely and compute live via MetricsService.
const stubSnapshotSvc = {
  getSnapshot: jest.fn().mockResolvedValue(null),
  getSnapshotStatus: jest.fn().mockResolvedValue([]),
};

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn().mockResolvedValue([{ boardId: 'ACC' }]),
    findOne: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<Repository<T>>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricsController + MetricsService integration — quarter routing', () => {
  let controller: MetricsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        { provide: DeploymentFrequencyService, useValue: stubDf },
        { provide: LeadTimeService, useValue: stubLt },
        { provide: CfrService, useValue: stubCfr },
        { provide: MttrService, useValue: stubMttr },
        { provide: CycleTimeService, useValue: stubCycleTime },
        { provide: DoraCacheService, useClass: DoraCacheService },
        { provide: TrendDataLoader, useValue: stubTrendLoader },
        { provide: DoraSnapshotReadService, useValue: stubSnapshotSvc },
        { provide: getRepositoryToken(JiraSprint), useValue: mockRepo<JiraSprint>() },
        { provide: getRepositoryToken(BoardConfig), useValue: mockRepo<BoardConfig>() },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockImplementation((_k: string, def?: unknown) => def ?? '') },
        },
      ],
    }).compile();

    controller = module.get(MetricsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('historical quarter returns period matching that quarter — not the current quarter', async () => {
    const res = { status: jest.fn(), setHeader: jest.fn() } as unknown as import('express').Response;

    const result = await controller.getDoraAggregate(
      { boardId: 'ACC', quarter: '2020-Q1' } as DoraAggregateQueryDto,
      res,
    ) as OrgDoraResult;

    // Snapshot service must NOT have been called for a historical quarter.
    expect(stubSnapshotSvc.getSnapshot).not.toHaveBeenCalled();

    // The period must correspond exactly to 2020-Q1.
    expect(result.period.label).toBe('2020-Q1');
    expect(result.period.start).toBe('2020-01-01T00:00:00.000Z');
    expect(result.period.end).toBe('2020-03-31T23:59:59.999Z');
  });

  it('historical quarter period.partial is false and elapsedDays equals totalDays', async () => {
    const res = { status: jest.fn(), setHeader: jest.fn() } as unknown as import('express').Response;

    const result = await controller.getDoraAggregate(
      { boardId: 'ACC', quarter: '2020-Q1' } as DoraAggregateQueryDto,
      res,
    ) as OrgDoraResult;

    expect(result.period.partial).toBe(false);
    expect(result.period.elapsedDays).toBe(result.period.totalDays);
  });

  it('board breakdowns contain matching period metadata for a historical quarter', async () => {
    const res = { status: jest.fn(), setHeader: jest.fn() } as unknown as import('express').Response;

    const result = await controller.getDoraAggregate(
      { boardId: 'ACC', quarter: '2020-Q1' } as DoraAggregateQueryDto,
      res,
    ) as OrgDoraResult;

    const bp = result.boardBreakdowns[0]?.period;
    expect(bp?.start).toBe('2020-01-01T00:00:00.000Z');
    expect(bp?.end).toBe('2020-03-31T23:59:59.999Z');
    expect(bp?.partial).toBe(false);
    expect(bp?.elapsedDays).toBe(bp?.totalDays);
  });

  it('no quarter param routes through snapshot (or 202 when snapshot absent)', async () => {
    const res = { status: jest.fn(), setHeader: jest.fn() } as unknown as import('express').Response;
    stubSnapshotSvc.getSnapshot.mockResolvedValueOnce(null);

    const result = await controller.getDoraAggregate(
      { boardId: 'ACC' } as DoraAggregateQueryDto,
      res,
    );

    // Snapshot service must have been called for the current-quarter path.
    expect(stubSnapshotSvc.getSnapshot).toHaveBeenCalled();
    // Returns 202 pending when snapshot is absent.
    expect((res as unknown as { status: jest.Mock }).status).toHaveBeenCalledWith(202);
    expect((result as { status: string }).status).toBe('pending');
  });
});
