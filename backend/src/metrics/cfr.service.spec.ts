import { CfrService } from './cfr.service.js';
import { Repository } from 'typeorm';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  BoardConfig,
  JiraIssueLink,
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
      getRawMany: jest.fn().mockResolvedValue([]),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  } as unknown as jest.Mocked<Repository<T>>;
}

describe('CfrService', () => {
  let service: CfrService;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let versionRepo: jest.Mocked<Repository<JiraVersion>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let issueLinkRepo: jest.Mocked<Repository<JiraIssueLink>>;

  beforeEach(() => {
    issueRepo = mockRepo<JiraIssue>();
    changelogRepo = mockRepo<JiraChangelog>();
    versionRepo = mockRepo<JiraVersion>();
    boardConfigRepo = mockRepo<BoardConfig>();
    issueLinkRepo = mockRepo<JiraIssueLink>();

    service = new CfrService(
      issueRepo,
      changelogRepo,
      versionRepo,
      boardConfigRepo,
      issueLinkRepo,
    );
  });

  it('should return 0% for empty board', async () => {
    const result = await service.calculate(
      'ACC',
      new Date('2025-01-01'),
      new Date('2025-03-31'),
    );

    expect(result.boardId).toBe('ACC');
    expect(result.changeFailureRate).toBe(0);
    expect(result.band).toBe('elite');
  });

  it('should calculate CFR based on failure issue types (10 events, 2 bugs → 20%)', async () => {
    const start = new Date('2025-01-01');
    const end = new Date('2025-03-31');

    boardConfigRepo.findOne.mockResolvedValue({
      boardId: 'ACC',
      boardType: 'scrum',
      doneStatusNames: ['Done'],
      failureIssueTypes: ['Bug'],
      failureLabels: [],
      failureLinkTypes: ['caused by'],
      inProgressStatusNames: ['In Progress'],
      dataStartDate: null,
    } as unknown as BoardConfig);

    // 10 issues, no fixVersion, all transitioned to Done in period.
    // ADR 0051: 10 first-done-transition events → totalDeployments=10.
    issueRepo.find.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        key: `ACC-${i + 1}`,
        boardId: 'ACC',
        issueType: i < 2 ? 'Bug' : 'Story',
        labels: [],
        fixVersion: null,
      })) as unknown as JiraIssue[],
    );

    versionRepo.find.mockResolvedValue([]);

    changelogRepo.find.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        issueKey: `ACC-${i + 1}`,
        field: 'status',
        toValue: 'Done',
        changedAt: new Date(`2025-02-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      })) as unknown as JiraChangelog[],
    );

    // Both Bug issues have a causal link
    const linkQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        { sourceIssueKey: 'ACC-1', targetIssueKey: 'ACC-99', linkTypeName: 'caused by', isInward: true },
        { sourceIssueKey: 'ACC-2', targetIssueKey: 'ACC-98', linkTypeName: 'caused by', isInward: true },
      ]),
    };
    issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue(linkQb);

    const result = await service.calculate('ACC', start, end);

    expect(result.totalDeployments).toBe(10);
    expect(result.failureCount).toBe(2);
    expect(result.changeFailureRate).toBe(20); // 2/10 * 100
    expect(result.band).toBe('low'); // >15%
  });

  // -------------------------------------------------------------------------
  // Fix C-1: failureLinkTypes default should be [] (not ['caused by', ...])
  // -------------------------------------------------------------------------
  describe('C-1: failureLinkTypes default', () => {
    it('skips link AND-gate when failureLinkTypes is not configured (default [])', async () => {
      // No BoardConfig row → failureLinkTypes defaults to []
      boardConfigRepo.findOne.mockResolvedValue(null);

      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      // One Bug deployed (no fixVersion, transitioned to Done) → 1 event
      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Bug', labels: [], fixVersion: null },
      ] as unknown as JiraIssue[]);

      versionRepo.find.mockResolvedValue([]);

      changelogRepo.find.mockResolvedValue([
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: new Date('2025-02-01') },
      ] as unknown as JiraChangelog[]);

      // No causal links — but gate should be SKIPPED when failureLinkTypes = []
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const result = await service.calculate('ACC', start, end);

      // Bug should be counted as failure without requiring a causal link
      expect(result.totalDeployments).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.changeFailureRate).toBe(100);
    });

    it('still applies link AND-gate when failureLinkTypes is explicitly configured', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'ACC',
        boardType: 'scrum',
        doneStatusNames: ['Done'],
        failureIssueTypes: ['Bug'],
        failureLabels: [],
        failureLinkTypes: ['caused by'],
        inProgressStatusNames: ['In Progress'],
        dataStartDate: null,
      } as unknown as BoardConfig);

      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Bug', labels: [], fixVersion: null },
      ] as unknown as JiraIssue[]);

      versionRepo.find.mockResolvedValue([]);

      changelogRepo.find.mockResolvedValue([
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: new Date('2025-02-01') },
      ] as unknown as JiraChangelog[]);

      // No causal links — gate SHOULD be applied
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const result = await service.calculate('ACC', start, end);

      // Bug has no causal link → should NOT be counted
      expect(result.totalDeployments).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(result.changeFailureRate).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // ADR 0051 (proposal 0049): totalDeployments counts deployment EVENTS,
  // not distinct days.  Supersedes proposal 0030 fix C-4.
  // -------------------------------------------------------------------------
  describe('ADR 0051: totalDeployments counts deployment events', () => {
    it('returns totalDeployments=1 for one version regardless of issue count', async () => {
      boardConfigRepo.findOne.mockResolvedValue(null); // default config, no link gate

      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      // One version released with 20 stories → 1 event
      versionRepo.find.mockResolvedValue([
        {
          id: 'v1', name: '2.0.0',
          releaseDate: new Date('2025-02-15'),
          projectKey: 'ACC', released: true,
        },
      ] as JiraVersion[]);

      issueRepo.find.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          key: `ACC-${i + 1}`,
          boardId: 'ACC',
          issueType: 'Story',
          labels: [],
          fixVersion: '2.0.0',
        })) as unknown as JiraIssue[],
      );

      const result = await service.calculate('ACC', start, end);

      expect(result.totalDeployments).toBe(1);
      expect(result.failureCount).toBe(0);
      expect(result.changeFailureRate).toBe(0);
    });

    it('returns totalDeployments=N for N versions sharing a release date (one event each)', async () => {
      boardConfigRepo.findOne.mockResolvedValue(null);

      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      // Three versions all released on 2025-02-01 → 3 events under ADR 0051
      versionRepo.find.mockResolvedValue([
        { id: 'v1', name: '1.0.0', releaseDate: new Date('2025-02-01T09:00:00Z'), projectKey: 'ACC', released: true },
        { id: 'v2', name: '1.0.1', releaseDate: new Date('2025-02-01T14:00:00Z'), projectKey: 'ACC', released: true },
        { id: 'v3', name: '1.0.2', releaseDate: new Date('2025-02-01T16:00:00Z'), projectKey: 'ACC', released: true },
      ] as JiraVersion[]);

      issueRepo.find.mockResolvedValue([] as JiraIssue[]);

      const result = await service.calculate('ACC', start, end);

      expect(result.totalDeployments).toBe(3);
    });

    it('returns totalDeployments=2 for two versions on different release days', async () => {
      boardConfigRepo.findOne.mockResolvedValue(null);

      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      versionRepo.find.mockResolvedValue([
        { id: 'v1', name: '1.0.0', releaseDate: new Date('2025-02-01'), projectKey: 'ACC', released: true },
        { id: 'v2', name: '1.1.0', releaseDate: new Date('2025-03-01'), projectKey: 'ACC', released: true },
      ] as JiraVersion[]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', labels: [], fixVersion: '1.0.0' },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', labels: [], fixVersion: '1.1.0' },
      ] as unknown as JiraIssue[]);

      const result = await service.calculate('ACC', start, end);

      expect(result.totalDeployments).toBe(2);
    });

    // ----------------------------------------------------------------------
    // Acceptance criterion from feature 0002 / proposal 0049:
    // 10 fixVersion releases + 3 bug failures → CFR = 30.0%
    // ----------------------------------------------------------------------
    it('AC: 10 fixVersion releases with 3 bug failures yields CFR = 30%', async () => {
      boardConfigRepo.findOne.mockResolvedValue(null);

      const start = new Date('2025-01-01');
      const end = new Date('2025-03-31');

      versionRepo.find.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `v${i}`,
          name: `1.${i}.0`,
          releaseDate: new Date(Date.UTC(2025, 1, i + 1)),
          projectKey: 'ACC',
          released: true,
        })) as unknown as JiraVersion[],
      );

      // Each release contains 1 issue; 3 of them are Bugs.
      issueRepo.find.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          key: `ACC-${i + 1}`,
          boardId: 'ACC',
          issueType: i < 3 ? 'Bug' : 'Story',
          labels: [],
          fixVersion: `1.${i}.0`,
        })) as unknown as JiraIssue[],
      );

      const result = await service.calculate('ACC', start, end);

      expect(result.totalDeployments).toBe(10); // 10 release events
      expect(result.failureCount).toBe(3);
      expect(result.changeFailureRate).toBe(30);
      expect(result.band).toBe('low'); // >15%
    });
  });

  // -------------------------------------------------------------------------
  // calculateFromData — in-memory variant for the trend path
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

    it('returns zero CFR for an empty slice', () => {
      const result = service.calculateFromData(makeSlice(), start, end);
      expect(result.boardId).toBe('ACC');
      expect(result.totalDeployments).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.changeFailureRate).toBe(0);
    });

    it('calculates CFR from pre-loaded version and issue data (1 event, 1 bug → 100%)', () => {
      const slice = makeSlice({
        boardConfig: {
          boardId: 'ACC',
          doneStatusNames: ['Done'],
          failureIssueTypes: ['Bug'],
          failureLabels: [],
          failureLinkTypes: [],
        } as never,
        issues: [
          { key: 'ACC-1', issueType: 'Story', fixVersion: 'v1.0', labels: [] } as unknown as JiraIssue,
          { key: 'ACC-2', issueType: 'Bug',   fixVersion: 'v1.0', labels: [] } as unknown as JiraIssue,
        ],
        versions: [
          { name: 'v1.0', releaseDate: new Date('2025-02-01'), projectKey: 'ACC', released: true } as JiraVersion,
        ],
        issueLinks: [],
      });

      const result = service.calculateFromData(slice, start, end);

      // 1 release event — but ACC-2 is a bug ⇒ 1/1 = 100%
      expect(result.totalDeployments).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.changeFailureRate).toBe(100);
    });

    it('applies failureLinkTypes AND-gate from pre-loaded issueLinks', () => {
      const slice = makeSlice({
        boardConfig: {
          boardId: 'ACC',
          doneStatusNames: ['Done'],
          failureIssueTypes: ['Bug'],
          failureLabels: [],
          failureLinkTypes: ['is caused by'],
        } as never,
        issues: [
          { key: 'ACC-1', issueType: 'Bug', fixVersion: 'v1.0', labels: [] } as unknown as JiraIssue,
          { key: 'ACC-2', issueType: 'Bug', fixVersion: 'v1.0', labels: [] } as unknown as JiraIssue,
        ],
        versions: [
          { name: 'v1.0', releaseDate: new Date('2025-02-01'), projectKey: 'ACC', released: true } as JiraVersion,
        ],
        // Only ACC-1 has a causal link — ACC-2 should be excluded
        issueLinks: [
          { sourceIssueKey: 'ACC-1', targetIssueKey: 'X-99', linkTypeName: 'is caused by', isInward: false } as JiraIssueLink,
        ],
      });

      const result = service.calculateFromData(slice, start, end);

      expect(result.failureCount).toBe(1); // only ACC-1 passes AND-gate
    });

    it('excludes versions outside the period', () => {
      const slice = makeSlice({
        issues: [{ key: 'ACC-1', issueType: 'Story', fixVersion: 'v2.0', labels: [] } as unknown as JiraIssue],
        versions: [
          // Outside period — must not count
          { name: 'v2.0', releaseDate: new Date('2025-06-01'), projectKey: 'ACC', released: true } as JiraVersion,
        ],
        issueLinks: [],
      });

      const result = service.calculateFromData(slice, start, end);
      expect(result.totalDeployments).toBe(0);
    });

    it('AC: 5 events on the same day are counted separately (ADR 0051)', () => {
      const day = new Date('2025-02-15');
      const slice = makeSlice({
        boardConfig: {
          boardId: 'ACC',
          doneStatusNames: ['Done'],
          failureIssueTypes: ['Bug'],
          failureLabels: [],
          failureLinkTypes: [],
        } as never,
        issues: [
          { key: 'ACC-1', issueType: 'Bug',   fixVersion: null, labels: [] } as unknown as JiraIssue,
          { key: 'ACC-2', issueType: 'Story', fixVersion: null, labels: [] } as unknown as JiraIssue,
          { key: 'ACC-3', issueType: 'Story', fixVersion: null, labels: [] } as unknown as JiraIssue,
          { key: 'ACC-4', issueType: 'Story', fixVersion: null, labels: [] } as unknown as JiraIssue,
          { key: 'ACC-5', issueType: 'Story', fixVersion: null, labels: [] } as unknown as JiraIssue,
        ],
        changelogs: Array.from({ length: 5 }, (_, i) => ({
          issueKey: `ACC-${i + 1}`,
          field: 'status',
          toValue: 'Done',
          changedAt: new Date(day.getTime() + i * 60 * 1000),
        })) as unknown as JiraChangelog[],
      });

      const result = service.calculateFromData(slice, start, end);

      // 5 done-transition events (was 1 day under C-4) → 1/5 = 20%
      expect(result.totalDeployments).toBe(5);
      expect(result.failureCount).toBe(1);
      expect(result.changeFailureRate).toBe(20);
    });
  });
});
