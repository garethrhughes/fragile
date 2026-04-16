import { DeploymentFrequencyService } from './deployment-frequency.service.js';
import { Repository } from 'typeorm';
import {
  JiraIssue,
  JiraVersion,
  JiraChangelog,
  BoardConfig,
} from '../database/entities/index.js';
import type { TrendDataSlice } from './trend-data-loader.service.js';

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  } as unknown as jest.Mocked<Repository<T>>;
}

describe('DeploymentFrequencyService', () => {
  let service: DeploymentFrequencyService;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let versionRepo: jest.Mocked<Repository<JiraVersion>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;

  beforeEach(() => {
    issueRepo = mockRepo<JiraIssue>();
    versionRepo = mockRepo<JiraVersion>();
    changelogRepo = mockRepo<JiraChangelog>();
    boardConfigRepo = mockRepo<BoardConfig>();

    service = new DeploymentFrequencyService(
      issueRepo,
      versionRepo,
      changelogRepo,
      boardConfigRepo,
    );
  });

  it('should return zero deployments for empty board', async () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-03-31');

    const result = await service.calculate('ACC', start, end);

    expect(result.boardId).toBe('ACC');
    expect(result.totalDeployments).toBe(0);
    expect(result.band).toBe('low');
  });

  // -------------------------------------------------------------------------
  // C-4: count distinct release DAYS not distinct issues
  // -------------------------------------------------------------------------

  describe('C-4: version-based deployments count distinct release days', () => {
    it('returns 2 for two versions with different release dates', async () => {
      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      versionRepo.find.mockResolvedValue([
        { id: 'v1', name: '1.0.0', releaseDate: new Date('2025-02-01'), projectKey: 'ACC', released: true },
        { id: 'v2', name: '1.1.0', releaseDate: new Date('2025-03-01'), projectKey: 'ACC', released: true },
      ] as JiraVersion[]);

      // issueRepo still needed for the no-version fallback path
      issueRepo.find.mockResolvedValue([] as JiraIssue[]);

      const result = await service.calculate('ACC', start, end);

      // 2 versions on 2 different days → 2 distinct deployment events
      expect(result.totalDeployments).toBe(2);
      expect(result.deploymentsPerDay).toBeGreaterThan(0);
    });

    it('returns 1 when multiple versions share the same release date', async () => {
      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      // Three versions all released on 2025-02-01 → 1 distinct release day
      versionRepo.find.mockResolvedValue([
        { id: 'v1', name: '1.0.0', releaseDate: new Date('2025-02-01T09:00:00Z'), projectKey: 'ACC', released: true },
        { id: 'v2', name: '1.0.1', releaseDate: new Date('2025-02-01T14:00:00Z'), projectKey: 'ACC', released: true },
        { id: 'v3', name: '1.0.2', releaseDate: new Date('2025-02-01T16:00:00Z'), projectKey: 'ACC', released: true },
      ] as JiraVersion[]);

      issueRepo.find.mockResolvedValue([] as JiraIssue[]);

      const result = await service.calculate('ACC', start, end);

      expect(result.totalDeployments).toBe(1);
    });

    it('returns 1 for one version containing 20 issues (C-4 acceptance criterion)', async () => {
      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      versionRepo.find.mockResolvedValue([
        { id: 'v1', name: '2.0.0', releaseDate: new Date('2025-02-15'), projectKey: 'ACC', released: true },
      ] as JiraVersion[]);

      issueRepo.find.mockResolvedValue([] as JiraIssue[]);

      const result = await service.calculate('ACC', start, end);

      // 1 version, 20 issues — should report 1 deployment, not 20
      expect(result.totalDeployments).toBe(1);
    });
  });

  it('should classify band correctly for daily deploys', async () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-01-02');

    versionRepo.find.mockResolvedValue([
      { id: 'v1', name: '1.0', releaseDate: new Date('2025-01-01'), projectKey: 'ACC', released: true },
    ] as JiraVersion[]);

    issueRepo.find.mockResolvedValue([] as JiraIssue[]);

    const result = await service.calculate('ACC', start, end);

    expect(result.band).toBe('elite');
  });

  // -------------------------------------------------------------------------
  // C-4: fallback path counts distinct transition DAYS not distinct issues
  // -------------------------------------------------------------------------

  describe('C-4: fallback counts distinct transition days', () => {
    it('returns 2 for issues completing on 2 distinct days (not 5 issues)', async () => {

      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'ACC',
        boardType: 'scrum',
        doneStatusNames: ['Done'],
      } as BoardConfig);

      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');
      versionRepo.find.mockResolvedValue([]);

      // 5 issues with no fixVersion
      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', issueType: 'Story', fixVersion: null },
        { key: 'ACC-2', issueType: 'Story', fixVersion: null },
        { key: 'ACC-3', issueType: 'Story', fixVersion: null },
        { key: 'ACC-4', issueType: 'Story', fixVersion: null },
        { key: 'ACC-5', issueType: 'Story', fixVersion: null },
      ] as JiraIssue[]);

      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        // 5 issues but only 2 distinct days
        getRawMany: jest.fn().mockResolvedValue([
          { transitionDay: '2025-02-01' },
          { transitionDay: '2025-02-08' },
        ]),
      };
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.calculate('ACC', start, end);

      expect(result.totalDeployments).toBe(2);
      expect(qb.andWhere).toHaveBeenCalledWith(
        'cl.toValue IN (:...statuses)',
        { statuses: ['Done'] },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Change 2: calculateFromData — in-memory variant for the trend path
  // -------------------------------------------------------------------------

  describe('calculateFromData', () => {
    function makeSlice(overrides: Partial<TrendDataSlice> = {}): TrendDataSlice {
      return {
        boardId: 'ACC',
        boardConfig: null,
        wtEntity: {} as never,
        issues: [],
        changelogs: [],
        versions: [],
        issueLinks: [],
        ...overrides,
      };
    }

    const start = new Date('2025-01-01');
    const end = new Date('2025-03-31');

    it('returns zero deployments for an empty slice', () => {
      const result = service.calculateFromData(makeSlice(), start, end);
      expect(result.boardId).toBe('ACC');
      expect(result.totalDeployments).toBe(0);
    });

    it('counts distinct release days from versions filtered to period', () => {
      const slice = makeSlice({
        versions: [
          { name: 'v1', releaseDate: new Date('2025-02-01'), projectKey: 'ACC', released: true } as JiraVersion,
          { name: 'v2', releaseDate: new Date('2025-02-08'), projectKey: 'ACC', released: true } as JiraVersion,
          // version outside the period — should be ignored
          { name: 'v3', releaseDate: new Date('2025-04-01'), projectKey: 'ACC', released: true } as JiraVersion,
        ],
      });

      const result = service.calculateFromData(slice, start, end);
      expect(result.totalDeployments).toBe(2);
    });

    it('collapses multiple versions on the same day to 1 deployment', () => {
      const slice = makeSlice({
        versions: [
          { name: 'v1', releaseDate: new Date('2025-02-01T09:00:00Z'), projectKey: 'ACC', released: true } as JiraVersion,
          { name: 'v2', releaseDate: new Date('2025-02-01T15:00:00Z'), projectKey: 'ACC', released: true } as JiraVersion,
        ],
      });

      const result = service.calculateFromData(slice, start, end);
      expect(result.totalDeployments).toBe(1);
    });

    it('uses fallback path for issues without fixVersion', () => {
      const doneAt = new Date('2025-02-10T10:00:00Z');
      const slice = makeSlice({
        boardConfig: { doneStatusNames: ['Done'] } as never,
        issues: [
          { key: 'ACC-1', issueType: 'Story', fixVersion: null } as JiraIssue,
          { key: 'ACC-2', issueType: 'Story', fixVersion: null } as JiraIssue,
        ],
        changelogs: [
          // Both issues done on the same day → 1 fallback deployment day
          { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: new Date('2025-02-10T09:00:00Z') } as JiraChangelog,
          { issueKey: 'ACC-2', field: 'status', toValue: 'Done', changedAt: doneAt } as JiraChangelog,
        ],
        versions: [],
      });

      const result = service.calculateFromData(slice, start, end);
      expect(result.totalDeployments).toBe(1);
    });

    it('does not include fallback transitions outside the period', () => {
      const slice = makeSlice({
        issues: [{ key: 'ACC-1', issueType: 'Story', fixVersion: null } as JiraIssue],
        changelogs: [
          // Before period start — must be excluded
          { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: new Date('2024-12-15') } as JiraChangelog,
        ],
        versions: [],
      });

      const result = service.calculateFromData(slice, start, end);
      expect(result.totalDeployments).toBe(0);
    });
  });
});
