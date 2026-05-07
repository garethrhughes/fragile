import { Repository } from 'typeorm';
import {
  SprintReportService,
  SprintReportResponse,
} from './sprint-report.service.js';
import { ScoringService } from './scoring.service.js';
import { RecommendationService } from './recommendation.service.js';
import { SprintDetailService } from '../sprint/sprint-detail.service.js';
import { PlanningService } from '../planning/planning.service.js';
import { RoadmapService } from '../roadmap/roadmap.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { GapsService } from '../gaps/gaps.service.js';
import { SprintReport, JiraSprint, SyncLog } from '../database/entities/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((e: T) => Promise.resolve(e)),
    delete: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  } as unknown as jest.Mocked<Repository<T>>;
}

function makeSprint(overrides: Partial<JiraSprint> = {}): JiraSprint {
  return {
    id: 'sprint-1',
    boardId: 'BOARD',
    name: 'Sprint 1',
    state: 'closed',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-01-14T00:00:00Z'),
    completeDate: new Date('2026-01-14T00:00:00Z'),
    ...overrides,
  } as unknown as JiraSprint;
}

interface BuildArgs {
  // Planning result row (or null/empty for "no planning data")
  planning?: unknown[];
  // Roadmap result row
  roadmap?: unknown[];
  // DORA result row
  dora?: unknown[];
  // Detail summary
  detailSummary?: Record<string, unknown>;
}

function buildService(args: BuildArgs = {}) {
  const reportRepo = mockRepo<SprintReport>();
  const sprintRepo = mockRepo<JiraSprint>();
  const syncLogRepo = mockRepo<SyncLog>();

  sprintRepo.findOne.mockResolvedValue(makeSprint());

  const detail = {
    summary: {
      committedCount: 0,
      addedMidSprintCount: 0,
      removedCount: 0,
      completedInSprintCount: 0,
      medianLeadTimeDays: null,
      incidentCount: 0,
      ...(args.detailSummary ?? {}),
    },
  };

  const sprintDetailService = {
    getDetail: jest.fn().mockResolvedValue(detail),
  } as unknown as SprintDetailService;

  const planningService = {
    getAccuracy: jest.fn().mockResolvedValue(args.planning ?? []),
  } as unknown as PlanningService;

  const roadmapService = {
    getAccuracy: jest.fn().mockResolvedValue(args.roadmap ?? []),
  } as unknown as RoadmapService;

  const metricsService = {
    getDora: jest.fn().mockResolvedValue(args.dora ?? []),
  } as unknown as MetricsService;

  const gapsService = {
    getUnplannedDone: jest.fn().mockResolvedValue(null),
  } as unknown as GapsService;

  const scoringService = new ScoringService();

  const recommendationService = {
    recommend: jest.fn().mockReturnValue([]),
  } as unknown as RecommendationService;

  const service = new SprintReportService(
    reportRepo,
    sprintRepo,
    syncLogRepo,
    sprintDetailService,
    planningService,
    roadmapService,
    metricsService,
    gapsService,
    scoringService,
    recommendationService,
  );

  return { service, scoringService, scoringSpy: jest.spyOn(scoringService, 'score') };
}

// ---------------------------------------------------------------------------
// Tests — proposal 0051 N/A propagation
// ---------------------------------------------------------------------------

describe('SprintReportService — N/A handling (proposal 0051)', () => {
  it('does not coerce missing DORA values to 0 or 9999', async () => {
    // No DORA data, no roadmap data, no planning data
    const { service, scoringSpy } = buildService({});

    await service.generateReport('BOARD', 'sprint-1');

    expect(scoringSpy).toHaveBeenCalledTimes(1);
    const input = scoringSpy.mock.calls[0]![0];

    // The pre-fix coercions were ?? 0 / ?? 9999 / ?? 0 / ?? 0.
    // After the fix, every missing DORA field must be null (and bands null).
    expect(input.medianLeadTimeDays).toBeNull();
    expect(input.deploymentsPerDay).toBeNull();
    expect(input.changeFailureRate).toBeNull();
    expect(input.medianMttrHours).toBeNull();
    expect(input.leadTimeBand).toBeNull();
    expect(input.dfBand).toBeNull();
    expect(input.cfrBand).toBeNull();
    expect(input.mttrBand).toBeNull();
  });

  it('returns excludedDimensions listing every N/A dimension', async () => {
    // No data at all → every dimension is excluded
    const { service } = buildService({});

    const response: SprintReportResponse = await service.generateReport('BOARD', 'sprint-1');

    expect(response.excludedDimensions).toEqual(
      expect.arrayContaining([
        'deliveryRate',
        'scopeStability',
        'roadmapCoverage',
        'leadTime',
        'deploymentFrequency',
        'changeFailureRate',
        'mttr',
      ]),
    );
    expect(response.excludedDimensions).toHaveLength(7);
    expect(response.compositeScore).toBeNull();
    expect(response.compositeBand).toBeNull();
  });

  it('returns contributingDimensions listing every dimension with data', async () => {
    // Provide all-data: planning + roadmap + dora
    const { service } = buildService({
      planning: [{ commitment: 10, added: 0, removed: 0, completed: 10 }],
      roadmap: [{ totalIssues: 10, roadmapCoverage: 80 }],
      dora: [{
        leadTime: { medianDays: 3, band: 'high' },
        deploymentFrequency: { deploymentsPerDay: 1, band: 'elite' },
        changeFailureRate: { changeFailureRate: 3, band: 'elite' },
        mttr: { medianHours: 0.5, band: 'elite' },
      }],
    });

    const response = await service.generateReport('BOARD', 'sprint-1');

    expect(response.contributingDimensions).toEqual(
      expect.arrayContaining([
        'deliveryRate',
        'scopeStability',
        'roadmapCoverage',
        'leadTime',
        'deploymentFrequency',
        'changeFailureRate',
        'mttr',
      ]),
    );
    expect(response.excludedDimensions).toEqual([]);
  });

  it('totalWeightApplied equals 1.0 when all dimensions have data', async () => {
    const { service } = buildService({
      planning: [{ commitment: 10, added: 0, removed: 0, completed: 10 }],
      roadmap: [{ totalIssues: 10, roadmapCoverage: 80 }],
      dora: [{
        leadTime: { medianDays: 3, band: 'high' },
        deploymentFrequency: { deploymentsPerDay: 1, band: 'elite' },
        changeFailureRate: { changeFailureRate: 3, band: 'elite' },
        mttr: { medianHours: 0.5, band: 'elite' },
      }],
    });

    const response = await service.generateReport('BOARD', 'sprint-1');
    expect(response.totalWeightApplied).toBeCloseTo(1.0);
  });

  it('totalWeightApplied equals 0.25 when only Delivery Rate is available', async () => {
    // planning gives delivery (committed > 0, addedMid > 0 so committedCount itself
    // is 0 from planning row but inScope > 0); to isolate ONLY delivery, we set
    // committed = 0 + added > 0 → scope stability null (denominator 0), delivery
    // valid (inScope = 0+added-0 > 0). Roadmap absent. DORA absent.
    const { service } = buildService({
      planning: [{ commitment: 0, added: 5, removed: 0, completed: 4 }],
    });

    const response = await service.generateReport('BOARD', 'sprint-1');

    expect(response.contributingDimensions).toEqual(['deliveryRate']);
    expect(response.totalWeightApplied).toBeCloseTo(0.25);
    expect(response.excludedDimensions).toEqual(
      expect.arrayContaining([
        'scopeStability',
        'roadmapCoverage',
        'leadTime',
        'deploymentFrequency',
        'changeFailureRate',
        'mttr',
      ]),
    );
    // composite = renormalised delivery score (4/5 = 0.8 → score 75)
    expect(response.compositeScore).toBe(75);
  });
});
