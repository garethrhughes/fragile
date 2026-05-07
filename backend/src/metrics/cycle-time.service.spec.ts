import { CycleTimeService } from './cycle-time.service.js';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  BoardConfig,
} from '../database/entities/index.js';
import { WorkingTimeService } from './working-time.service.js';

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  } as unknown as jest.Mocked<Repository<T>>;
}

function mockConfigService(jiraBaseUrl = ''): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation((_key: string, defaultVal?: unknown) => {
      if (_key === 'JIRA_BASE_URL') return jiraBaseUrl;
      return defaultVal ?? '';
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function buildQb(changelogs: object[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(changelogs),
  };
}

describe('CycleTimeService', () => {
  let service: CycleTimeService;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let versionRepo: jest.Mocked<Repository<JiraVersion>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let workingTimeService: jest.Mocked<WorkingTimeService>;

  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-03-31T23:59:59Z');

  beforeEach(() => {
    issueRepo = mockRepo<JiraIssue>();
    changelogRepo = mockRepo<JiraChangelog>();
    versionRepo = mockRepo<JiraVersion>();
    boardConfigRepo = mockRepo<BoardConfig>();

    workingTimeService = {
      getConfig: jest.fn().mockResolvedValue({
        id: 1, excludeWeekends: false, workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [],
      }),
      toConfig: jest.fn().mockReturnValue({
        timezone: 'UTC', workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [],
      }),
      workingDaysBetween: jest.fn(),
      workingHoursBetween: jest.fn(),
    } as unknown as jest.Mocked<WorkingTimeService>;

    service = new CycleTimeService(
      issueRepo,
      changelogRepo,
      versionRepo,
      boardConfigRepo,
      mockConfigService(),
      workingTimeService,
    );
  });

  // ---------------------------------------------------------------------------
  // Empty board
  // ---------------------------------------------------------------------------

  it('returns zero result for empty board', async () => {
    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.boardId).toBe('ACC');
    expect(result.count).toBe(0);
    expect(result.anomalyCount).toBe(0);
    // Proposal 0054 AC5: empty data returns null percentiles + null band
    // (no longer misclassified as 'excellent').
    expect(result.p50Days).toBeNull();
    expect(result.band).toBeNull();
    expect(result.reopenedIssueCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Basic happy path
  // ---------------------------------------------------------------------------

  it('calculates cycle time from In Progress → Done within window', async () => {
    const inProgressAt = new Date('2026-01-10T09:00:00Z');
    const doneAt = new Date('2026-01-13T09:00:00Z'); // 3 days later

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Do thing', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.count).toBe(1);
    expect(result.anomalyCount).toBe(0);
    expect(result.p50Days).toBe(3);
    expect(result.band).toBe('good'); // 3 > 2 but <= 5 = 'good'
  });

  it('band is "good" for 3-day cycle time (threshold: ≤2 excellent, ≤5 good)', async () => {
    const inProgressAt = new Date('2026-01-10T00:00:00Z');
    const doneAt = new Date('2026-01-13T00:00:00Z'); // exactly 3 days

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Task', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.p50Days).toBe(3);
    expect(result.band).toBe('good');
  });

  // ---------------------------------------------------------------------------
  // Window-scoped anomaly: done in window, no in-progress transition
  // ---------------------------------------------------------------------------

  it('counts issue with done-transition but no in-progress as anomaly (not in count)', async () => {
    const doneAt = new Date('2026-01-15T10:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Quick fix', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    // Only a Done changelog — no In Progress transition
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.count).toBe(0);
    expect(result.anomalyCount).toBe(1);
    // Proposal 0054 AC5: zero observations → null percentiles
    expect(result.p50Days).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Issue with no done-transition in window: skipped entirely (not anomaly)
  // ---------------------------------------------------------------------------

  it('skips issue with no done-transition in window (not an anomaly)', async () => {
    // inProgressAt is within window but doneAt is outside window
    const inProgressAt = new Date('2026-01-05T00:00:00Z');
    const doneAt = new Date('2026-04-10T00:00:00Z'); // outside Q1

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Long work', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    // Neither count nor anomalyCount — issue simply not part of this period
    expect(result.count).toBe(0);
    expect(result.anomalyCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Done before In Progress: no completed cycle (proposal 0054)
  // ---------------------------------------------------------------------------

  it('skips issue with Done-before-InProgress as no completed cycle exists (proposal 0054)', async () => {
    // doneAt is BEFORE inProgressAt (data anomaly).
    // Under canonical sorted-ASC cycle semantics (proposal 0054 / extractCycles),
    // the leading Done is ignored, the IP opens an unterminated cycle, and no
    // completed cycle is emitted. The previous "clamp negative duration to 0"
    // shortcut is gone because it concealed the underlying data issue.
    const inProgressAt = new Date('2026-01-15T00:00:00Z');
    const doneAt = new Date('2026-01-10T00:00:00Z'); // earlier than In Progress

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Weird', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    // No completed cycle: not counted, and not a window-scoped anomaly because
    // an In Progress transition exists for this issue.
    expect(result.count).toBe(0);
    expect(result.anomalyCount).toBe(0);
    expect(result.p50Days).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Epics and Sub-tasks are excluded
  // ---------------------------------------------------------------------------

  it('excludes Epics from cycle time calculation', async () => {
    const inProgressAt = new Date('2026-01-10T00:00:00Z');
    const doneAt = new Date('2026-01-15T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Epic', summary: 'Big', fixVersion: null },
      { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', summary: 'Small', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
        { issueKey: 'ACC-2', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-2', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.count).toBe(1); // only ACC-2 (Story)
    expect(result.observations[0].issueKey).toBe('ACC-2');
  });

  it('returns empty immediately for excluded issueTypeFilter (Epic)', async () => {
    const result = await service.calculate('ACC', start, end, '2026-Q1', 'Epic');

    expect(result.count).toBe(0);
    expect(result.anomalyCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // issueTypeFilter
  // ---------------------------------------------------------------------------

  it('filters by issueTypeFilter when provided', async () => {
    const inProgressAt = new Date('2026-01-10T00:00:00Z');
    const doneAt = new Date('2026-01-12T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Bug', summary: 'Fix', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1', 'Bug');

    expect(result.count).toBe(1);
    expect(result.observations[0].issueKey).toBe('ACC-1');
  });

  // ---------------------------------------------------------------------------
  // fixVersion fallback
  // ---------------------------------------------------------------------------

  it('uses fixVersion releaseDate as cycleEnd when no done-transition exists', async () => {
    const releaseDate = new Date('2026-02-01T00:00:00Z');
    const inProgressAt = new Date('2026-01-20T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Release', fixVersion: 'v1.0' },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([
      { name: 'v1.0', projectKey: 'ACC', releaseDate },
    ] as unknown as JiraVersion[]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        // No Done transition — only fixVersion
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.count).toBe(1);
    expect(result.observations[0].issueKey).toBe('ACC-1');
    // cycle time = releaseDate - inProgressAt = 12 days
    expect(result.p50Days).toBe(12);
  });

  // ---------------------------------------------------------------------------
  // jiraUrl generation
  // ---------------------------------------------------------------------------

  it('includes jiraUrl when JIRA_BASE_URL is configured', async () => {
    service = new CycleTimeService(
      issueRepo,
      changelogRepo,
      versionRepo,
      boardConfigRepo,
      mockConfigService('https://mycompany.atlassian.net'),
      workingTimeService,
    );

    const inProgressAt = new Date('2026-01-05T00:00:00Z');
    const doneAt = new Date('2026-01-07T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Link test', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.observations[0].jiraUrl).toBe('https://mycompany.atlassian.net/browse/ACC-1');
  });

  it('returns empty jiraUrl when JIRA_BASE_URL is not configured', async () => {
    const inProgressAt = new Date('2026-01-05T00:00:00Z');
    const doneAt = new Date('2026-01-07T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'No URL', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.observations[0].jiraUrl).toBe('');
  });

  // ---------------------------------------------------------------------------
  // Custom board config (inProgressStatusNames / doneStatusNames)
  // ---------------------------------------------------------------------------

  it('uses custom inProgressStatusNames from board config', async () => {
    boardConfigRepo.findOne.mockResolvedValue({
      boardId: 'ACC',
      inProgressStatusNames: ['Doing'],
      doneStatusNames: ['Done'],
    } as unknown as BoardConfig);

    const doingAt = new Date('2026-01-08T00:00:00Z');
    const doneAt = new Date('2026-01-10T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Custom', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'Doing', changedAt: doingAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.count).toBe(1);
    expect(result.p50Days).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Multiple issues: percentile ordering
  // ---------------------------------------------------------------------------

  it('calculates percentiles across multiple issues', async () => {
    // 5 issues: 1, 2, 3, 4, 5 days each
    const issues = [1, 2, 3, 4, 5].map((days) => ({
      key: `ACC-${days}`,
      boardId: 'ACC',
      issueType: 'Story',
      summary: `Task ${days}`,
      fixVersion: null,
    }));

    issueRepo.find.mockResolvedValue(issues as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);

    const baseStart = new Date('2026-01-01T00:00:00Z');
    const changelogs = issues.flatMap((issue, i) => [
      {
        issueKey: issue.key,
        field: 'status',
        toValue: 'In Progress',
        changedAt: new Date(baseStart.getTime() + i * 7 * 24 * 60 * 60 * 1000),
      },
      {
        issueKey: issue.key,
        field: 'status',
        toValue: 'Done',
        changedAt: new Date(baseStart.getTime() + i * 7 * 24 * 60 * 60 * 1000 + (i + 1) * 24 * 60 * 60 * 1000),
      },
    ]);

    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb(changelogs));

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.count).toBe(5);
    // count > 0 → percentile fields are non-null (proposal 0054 AC5).
    expect(result.p50Days).not.toBeNull();
    expect(result.p75Days).not.toBeNull();
    expect(result.p85Days).not.toBeNull();
    expect(result.p95Days).not.toBeNull();
    expect(result.p50Days!).toBeGreaterThan(0);
    expect(result.p95Days!).toBeGreaterThanOrEqual(result.p85Days!);
    expect(result.p85Days!).toBeGreaterThanOrEqual(result.p75Days!);
    expect(result.p75Days!).toBeGreaterThanOrEqual(result.p50Days!);
  });

  // ---------------------------------------------------------------------------
  // getCycleTimeObservations directly
  // ---------------------------------------------------------------------------

  it('getCycleTimeObservations returns observations and anomalyCount', async () => {
    const inProgressAt = new Date('2026-01-02T00:00:00Z');
    const doneAt = new Date('2026-01-04T00:00:00Z');
    const doneAtAnomalous = new Date('2026-01-08T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Normal', fixVersion: null },
      { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', summary: 'Anomaly', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
        // ACC-2 has Done but no In Progress → anomaly
        { issueKey: 'ACC-2', field: 'status', toValue: 'Done', changedAt: doneAtAnomalous },
      ]),
    );

    const { observations, anomalyCount } = await service.getCycleTimeObservations(
      'ACC',
      start,
      end,
      '2026-Q1',
    );

    expect(observations).toHaveLength(1);
    expect(observations[0].issueKey).toBe('ACC-1');
    expect(anomalyCount).toBe(1);
  });

  it('periodKey is embedded in each observation', async () => {
    const inProgressAt = new Date('2026-01-02T00:00:00Z');
    const doneAt = new Date('2026-01-04T00:00:00Z');

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Test', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const { observations } = await service.getCycleTimeObservations(
      'ACC',
      start,
      end,
      'my-period-key',
    );

    expect(observations[0].periodKey).toBe('my-period-key');
  });

  // ---------------------------------------------------------------------------
  // Reopened issue: representative cycle is the LATEST cycle (proposal 0054 AC1)
  // ---------------------------------------------------------------------------

  it('uses the latest cycle (reopen → second Done) and marks it as a reopen', async () => {
    const inProgressAt = new Date('2026-01-02T00:00:00Z');
    const firstDoneAt = new Date('2026-01-05T00:00:00Z');
    const resetAt = new Date('2026-01-08T00:00:00Z');
    const reopenAt = new Date('2026-01-10T00:00:00Z');
    const secondDoneAt = new Date('2026-01-14T00:00:00Z');
    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Reopened', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: firstDoneAt },
        // Reset transition between cycles (per proposal 0054 reset semantics)
        { issueKey: 'ACC-1', field: 'status', toValue: 'To Do', changedAt: resetAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: reopenAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: secondDoneAt },
      ]),
    );

    const { observations, reopenedIssueCount } = await service.getCycleTimeObservations(
      'ACC',
      start,
      end,
      '2026-Q1',
    );

    expect(observations).toHaveLength(1);
    // Representative cycle = LATEST cycle: reopenAt → secondDoneAt (proposal 0054 AC1)
    expect(observations[0].completedAt).toBe(secondDoneAt.toISOString());
    expect(observations[0].startedAt).toBe(reopenAt.toISOString());
    expect(observations[0].isReopen).toBe(true);
    const expectedDays = (secondDoneAt.getTime() - reopenAt.getTime()) / (1000 * 60 * 60 * 24);
    expect(observations[0].cycleTimeDays).toBeCloseTo(expectedDays, 1);
    expect(reopenedIssueCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // excludeWeekends = true: delegates to WorkingTimeService
  // ---------------------------------------------------------------------------

  it('uses workingDaysBetween when excludeWeekends is true', async () => {
    // Override the mock to enable excludeWeekends
    workingTimeService.getConfig.mockResolvedValue({
      id: 1, excludeWeekends: true, workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [],
    });
    workingTimeService.workingDaysBetween.mockReturnValue(2.5);

    const inProgressAt = new Date('2026-01-09T00:00:00Z'); // Friday
    const doneAt = new Date('2026-01-12T00:00:00Z');       // Monday

    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Weekend span', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    // workingDaysBetween was called with the correct start/end dates
    expect(workingTimeService.workingDaysBetween).toHaveBeenCalledWith(
      inProgressAt,
      doneAt,
      expect.anything(),
    );
    // The returned value from workingDaysBetween is used as cycleTimeDays
    expect(result.p50Days).toBe(2.5);
  });

  // ---------------------------------------------------------------------------
  // reopenedIssueCount aggregation across multiple issues (proposal 0054 AC C)
  // ---------------------------------------------------------------------------

  it('aggregates reopenedIssueCount across multiple issues', async () => {
    // 3 issues: ACC-1 (no reopen), ACC-2 and ACC-3 (each reopened once).
    // Expect reopenedIssueCount = 2.
    issueRepo.find.mockResolvedValue([
      { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', summary: 'Single', fixVersion: null },
      { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', summary: 'Reopen-1', fixVersion: null },
      { key: 'ACC-3', boardId: 'ACC', issueType: 'Story', summary: 'Reopen-2', fixVersion: null },
    ] as unknown as JiraIssue[]);
    versionRepo.find.mockResolvedValue([]);

    const ip1 = new Date('2026-01-02T00:00:00Z');
    const done1 = new Date('2026-01-05T00:00:00Z');

    const ip2a = new Date('2026-01-02T00:00:00Z');
    const done2a = new Date('2026-01-04T00:00:00Z');
    const reset2 = new Date('2026-01-06T00:00:00Z');
    const ip2b = new Date('2026-01-08T00:00:00Z');
    const done2b = new Date('2026-01-10T00:00:00Z');

    const ip3a = new Date('2026-01-03T00:00:00Z');
    const done3a = new Date('2026-01-05T00:00:00Z');
    const reset3 = new Date('2026-01-07T00:00:00Z');
    const ip3b = new Date('2026-01-09T00:00:00Z');
    const done3b = new Date('2026-01-12T00:00:00Z');

    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      buildQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: ip1 },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: done1 },

        { issueKey: 'ACC-2', field: 'status', toValue: 'In Progress', changedAt: ip2a },
        { issueKey: 'ACC-2', field: 'status', toValue: 'Done', changedAt: done2a },
        { issueKey: 'ACC-2', field: 'status', toValue: 'To Do', changedAt: reset2 },
        { issueKey: 'ACC-2', field: 'status', toValue: 'In Progress', changedAt: ip2b },
        { issueKey: 'ACC-2', field: 'status', toValue: 'Done', changedAt: done2b },

        { issueKey: 'ACC-3', field: 'status', toValue: 'In Progress', changedAt: ip3a },
        { issueKey: 'ACC-3', field: 'status', toValue: 'Done', changedAt: done3a },
        { issueKey: 'ACC-3', field: 'status', toValue: 'To Do', changedAt: reset3 },
        { issueKey: 'ACC-3', field: 'status', toValue: 'In Progress', changedAt: ip3b },
        { issueKey: 'ACC-3', field: 'status', toValue: 'Done', changedAt: done3b },
      ]),
    );

    const result = await service.calculate('ACC', start, end, '2026-Q1');

    expect(result.count).toBe(3);
    expect(result.reopenedIssueCount).toBe(2);
    // Representative cycles for ACC-2 and ACC-3 should be marked as reopens
    const reopenObs = result.observations.filter((o) => o.isReopen);
    expect(reopenObs.map((o) => o.issueKey).sort()).toEqual(['ACC-2', 'ACC-3']);
  });
});
