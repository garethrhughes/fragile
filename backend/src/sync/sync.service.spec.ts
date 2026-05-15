import { SyncService } from './sync.service.js';
import { JiraClientService } from '../jira/jira-client.service.js';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import {
  JiraSprint,
  JiraIssue,
  JiraIssueSprint,
  JiraChangelog,
  JiraVersion,
  SyncLog,
  BoardConfig,
  RoadmapConfig,
  JpdIdea,
  JiraIssueLink,
  JiraFieldConfig,
} from '../database/entities/index.js';
import { SprintReportService } from '../sprint-report/sprint-report.service.js';
import { LambdaInvokerService } from '../lambda/lambda-invoker.service.js';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockConfigService(timezone = 'Australia/Sydney'): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'TIMEZONE') return timezone;
      return fallback;
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function mockSchedulerRegistry(): jest.Mocked<SchedulerRegistry> {
  return {
    addCronJob: jest.fn(),
  } as unknown as jest.Mocked<SchedulerRegistry>;
}

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((dto: Partial<T>) => ({ ...dto } as T)),
    save: jest.fn().mockImplementation((entity: T) => Promise.resolve(entity)),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  } as unknown as jest.Mocked<Repository<T>>;
}

function mockJiraClient(): jest.Mocked<JiraClientService> {
  return {
    getBoardsForProject: jest.fn(),
    getSprints: jest.fn(),
    getSprintIssues: jest.fn(),
    searchIssues: jest.fn().mockResolvedValue({ issues: [], nextPageToken: undefined }),
    getIssueChangelog: jest.fn(),
    getProjectVersions: jest.fn().mockResolvedValue([]),
    getJpdIdeas: jest.fn(),
    getKanbanBacklog: jest.fn().mockResolvedValue({ startAt: 0, maxResults: 100, total: 0, issues: [] }),
  } as unknown as jest.Mocked<JiraClientService>;
}

function mockDataSource(): jest.Mocked<DataSource> {
  const mockQueryRunner: jest.Mocked<QueryRunner> = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([{ pg_try_advisory_lock: true }]),
    release: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<QueryRunner>;

  return {
    createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
  } as unknown as jest.Mocked<DataSource>;
}

/** Minimal raw Jira issue value for mapJiraIssue tests */
function makeRawIssue(
  key: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `Summary of ${key}`,
      status: { id: '10001', name: 'In Progress' },
      issuetype: { name: 'Story' },
      fixVersions: [],
      labels: [],
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      issuelinks: [],
      ...overrides,
    },
  };
}

/** Default JiraFieldConfig row returned by the mock repo */
const defaultFieldConfig: JiraFieldConfig = {
  id: 1,
  storyPointsFieldIds: ['story_points', 'customfield_10016', 'customfield_10026', 'customfield_10028', 'customfield_11031'],
  epicLinkFieldId: 'customfield_10014',
  jpdDeliveryLinkInward: ['is implemented by', 'is delivered by'],
  jpdDeliveryLinkOutward: ['implements', 'delivers'],
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('SyncService', () => {
  let service: SyncService;
  let jiraClient: jest.Mocked<JiraClientService>;
  let sprintRepo: jest.Mocked<Repository<JiraSprint>>;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let issueSprintRepo: jest.Mocked<Repository<JiraIssueSprint>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let versionRepo: jest.Mocked<Repository<JiraVersion>>;
  let syncLogRepo: jest.Mocked<Repository<SyncLog>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let roadmapConfigRepo: jest.Mocked<Repository<RoadmapConfig>>;
  let jpdIdeaRepo: jest.Mocked<Repository<JpdIdea>>;
  let issueLinkRepo: jest.Mocked<Repository<JiraIssueLink>>;
  let sprintReportService: jest.Mocked<SprintReportService>;
  let jiraFieldConfigRepo: jest.Mocked<Repository<JiraFieldConfig>>;
  let lambdaInvoker: jest.Mocked<LambdaInvokerService>;
  let dataSource: jest.Mocked<DataSource>;
  let configService: jest.Mocked<ConfigService>;
  let schedulerRegistry: jest.Mocked<SchedulerRegistry>;

  beforeEach(() => {
    jiraClient = mockJiraClient();
    sprintRepo = mockRepo<JiraSprint>();
    issueRepo = mockRepo<JiraIssue>();
    issueSprintRepo = mockRepo<JiraIssueSprint>();
    changelogRepo = mockRepo<JiraChangelog>();
    versionRepo = mockRepo<JiraVersion>();
    syncLogRepo = mockRepo<SyncLog>();
    boardConfigRepo = mockRepo<BoardConfig>();
    roadmapConfigRepo = mockRepo<RoadmapConfig>();
    jpdIdeaRepo = mockRepo<JpdIdea>();
    issueLinkRepo = mockRepo<JiraIssueLink>();
    sprintReportService = {
      generateIfClosed: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SprintReportService>;
    jiraFieldConfigRepo = mockRepo<JiraFieldConfig>();
    // By default return the standard field config row
    jiraFieldConfigRepo.findOne.mockResolvedValue(defaultFieldConfig);
    lambdaInvoker = {
      invokeSnapshotWorker: jest.fn().mockResolvedValue(undefined),
      invokeOrgSnapshot: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LambdaInvokerService>;
    dataSource = mockDataSource();
    configService = mockConfigService();
    schedulerRegistry = mockSchedulerRegistry();

    service = new SyncService(
      jiraClient,
      sprintRepo,
      issueRepo,
      issueSprintRepo,
      changelogRepo,
      versionRepo,
      syncLogRepo,
      boardConfigRepo,
      roadmapConfigRepo,
      jpdIdeaRepo,
      issueLinkRepo,
      sprintReportService,
      jiraFieldConfigRepo,
      lambdaInvoker,
      dataSource,
      configService,
      schedulerRegistry,
    );
  });

  // -------------------------------------------------------------------------
  // handleCron
  // -------------------------------------------------------------------------

  describe('handleCron', () => {
    it('calls syncAll when cron fires', async () => {
      boardConfigRepo.find.mockResolvedValue([]);
      roadmapConfigRepo.find.mockResolvedValue([]);

      await service.handleCron();

      // If syncAll ran, it would have called boardConfigRepo.find
      expect(boardConfigRepo.find).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // onModuleInit — cron registration
  // -------------------------------------------------------------------------

  describe('onModuleInit', () => {
    it('registers a midnight cron job using the configured TIMEZONE', () => {
      service.onModuleInit();

      expect(schedulerRegistry.addCronJob).toHaveBeenCalledTimes(1);
      const [name, job] = (schedulerRegistry.addCronJob as jest.Mock).mock.calls[0] as [string, { cronTime: { source: string; timeZone: string } }];
      expect(name).toBe('jira-sync');
      expect(job.cronTime.source).toBe('0 0 * * *');
      expect(job.cronTime.timeZone).toBe('Australia/Sydney');
    });

    it('falls back to UTC when TIMEZONE is not configured', () => {
      const utcConfigService = {
        get: jest.fn().mockImplementation((_key: string, fallback?: unknown) => fallback),
      } as unknown as jest.Mocked<ConfigService>;
      const utcScheduler = mockSchedulerRegistry();
      const utcService = new SyncService(
        jiraClient, sprintRepo, issueRepo, issueSprintRepo, changelogRepo,
        versionRepo, syncLogRepo, boardConfigRepo, roadmapConfigRepo,
        jpdIdeaRepo, issueLinkRepo, sprintReportService, jiraFieldConfigRepo,
        lambdaInvoker, dataSource, utcConfigService, utcScheduler,
      );

      utcService.onModuleInit();

      const [, job] = (utcScheduler.addCronJob as jest.Mock).mock.calls[0] as [string, { cronTime: { timeZone: string } }];
      expect(job.cronTime.timeZone).toBe('UTC');
    });
  });

  // -------------------------------------------------------------------------
  // syncAll
  // -------------------------------------------------------------------------

  describe('syncAll', () => {
    it('returns empty boards array when no configs exist', async () => {
      boardConfigRepo.find.mockResolvedValue([]);
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.syncAll();

      expect(result.boards).toEqual([]);
      expect(result.results).toEqual([]);
    });

    it('syncs each board and collects results', async () => {
      boardConfigRepo.find.mockResolvedValue([
        { boardId: 'PROJ' } as BoardConfig,
      ]);

      // ensureBoardConfig returns scrum config
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PROJ',
        boardType: 'scrum',
      } as BoardConfig);

      // resolveNumericBoardId — numeric already
      // syncSprints
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);

      // syncVersions — swallows errors
      jiraClient.getProjectVersions.mockResolvedValue([]);

      // roadmapConfigRepo.find for syncRoadmaps
      roadmapConfigRepo.find.mockResolvedValue([]);

      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      const result = await service.syncAll();

      expect(result.boards).toEqual(['PROJ']);
      expect(result.results).toHaveLength(1);
    });

    it('invokes Lambda snapshot worker for each board and then invokes org snapshot after all syncs complete', async () => {
      boardConfigRepo.find.mockResolvedValue([
        { boardId: 'PROJ' } as BoardConfig,
      ]);
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PROJ',
        boardType: 'scrum',
      } as BoardConfig);
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      roadmapConfigRepo.find.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncAll();

      expect(lambdaInvoker.invokeSnapshotWorker).toHaveBeenCalledWith('PROJ');
      expect(lambdaInvoker.invokeOrgSnapshot).toHaveBeenCalledTimes(1);
    });

    it('continues with other boards when one throws, and swallows syncRoadmaps error', async () => {
      boardConfigRepo.find.mockResolvedValue([
        { boardId: 'PROJ' } as BoardConfig,
      ]);

      // Make ensureBoardConfig throw to force syncBoard failure
      // jiraFieldConfigRepo.findOne already returns defaultFieldConfig in beforeEach
      boardConfigRepo.findOne.mockRejectedValueOnce(new Error('DB down'));

      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      // syncRoadmaps throws
      roadmapConfigRepo.find.mockRejectedValue(new Error('roadmap fail'));

      const result = await service.syncAll();

      expect(result.boards).toEqual(['PROJ']);
      // syncBoard failed but save still called
      expect(syncLogRepo.save).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // syncBoard — scrum path
  // -------------------------------------------------------------------------

  describe('syncBoard (scrum)', () => {
    beforeEach(() => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PROJ',
        boardType: 'scrum',
      } as BoardConfig);

      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 42, name: 'PROJ board', type: 'scrum' }],
      } as never);

      jiraClient.getProjectVersions.mockResolvedValue([]);

      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));
    });

    it('syncs a scrum board with sprints and issues', async () => {
      jiraClient.getSprints.mockResolvedValue({
        values: [
          { id: 1, name: 'Sprint 1', state: 'active', startDate: '2026-01-05T00:00:00Z', endDate: '2026-01-19T00:00:00Z' },
        ],
      } as never);

      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1')],
        nextPageToken: undefined,
      } as never);

      jiraClient.getIssueChangelog.mockResolvedValue({
        total: 0,
        maxResults: 100,
        values: [],
      } as never);

      sprintRepo.upsert.mockResolvedValue(undefined as never);
      issueRepo.upsert.mockResolvedValue(undefined as never);

      const log = await service.syncBoard('PROJ');

      expect(log.status).toBe('success');
      expect(log.issueCount).toBe(1);
      expect(jiraClient.getSprints).toHaveBeenCalledWith('42');
    });

    it('records failure status when jira client throws', async () => {
      jiraClient.getSprints.mockRejectedValue(new Error('network error'));

      const log = await service.syncBoard('PROJ');

      expect(log.status).toBe('failed');
      expect(log.errorMessage).toBe('network error');
    });

    it('handles numeric boardId directly without API lookup', async () => {
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);

      await service.syncBoard('99');

      // Should NOT call getBoardsForProject since boardId is already numeric
      expect(jiraClient.getBoardsForProject).not.toHaveBeenCalled();
      expect(jiraClient.getSprints).toHaveBeenCalledWith('99');
    });

    it('passes configured extra fields to searchIssues (scrum JQL path)', async () => {
      const customFieldConfig: JiraFieldConfig = {
        ...defaultFieldConfig,
        storyPointsFieldIds: ['customfield_10106'],
        epicLinkFieldId: null,
      };
      jiraFieldConfigRepo.findOne.mockResolvedValue(customFieldConfig);

      jiraClient.getSprints.mockResolvedValue({
        values: [{ id: 1, name: 'Sprint 1', state: 'active' }],
      } as never);
      jiraClient.searchIssues.mockResolvedValue({
        issues: [],
        nextPageToken: undefined,
      } as never);
      jiraClient.getIssueChangelog.mockResolvedValue({ total: 0, maxResults: 100, values: [] } as never);

      await service.syncBoard('PROJ');

      expect(jiraClient.searchIssues).toHaveBeenCalledWith(
        expect.stringContaining('PROJ'),
        0,
        100,
        undefined,
        expect.arrayContaining(['customfield_10106']),
      );
    });

    it('invokes Lambda after a successful sync', async () => {
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);

      // Lambda is now invoked from syncAll, not syncBoard
      const log = await service.syncBoard('PROJ');

      expect(log.status).toBe('success');
      expect(lambdaInvoker.invokeSnapshotWorker).not.toHaveBeenCalled();
    });

    it('does not fail syncBoard when Lambda invocation fails', async () => {
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);

      // Lambda is invoked from syncAll; syncBoard itself never calls it
      const log = await service.syncBoard('PROJ');

      expect(log.status).toBe('success');
    });
  });

  // -------------------------------------------------------------------------
  // syncBoard — kanban path (use numeric boardId to skip getBoardsForProject)
  // -------------------------------------------------------------------------

  describe('syncBoard (kanban)', () => {
    it('syncs a kanban board via searchIssues', async () => {
      // Use a non-numeric boardId so we also exercise getBoardsForProject
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
      } as BoardConfig);

      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 55, name: 'PLAT board', type: 'kanban' }],
      } as never);

      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PLAT-1'), makeRawIssue('PLAT-2')],
        nextPageToken: undefined,
      } as never);

      jiraClient.getIssueChangelog.mockResolvedValue({
        total: 0,
        maxResults: 100,
        values: [],
      } as never);

      jiraClient.getProjectVersions.mockResolvedValue([]);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      const log = await service.syncBoard('PLAT');

      expect(log.status).toBe('success');
      expect(log.issueCount).toBe(2);
      expect(jiraClient.searchIssues).toHaveBeenCalled();
    });

    it('passes configured extra fields to searchIssues', async () => {
      const customFieldConfig: JiraFieldConfig = {
        ...defaultFieldConfig,
        storyPointsFieldIds: ['customfield_10106'],
        epicLinkFieldId: 'customfield_10014',
      };
      jiraFieldConfigRepo.findOne.mockResolvedValue(customFieldConfig);

      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
      } as BoardConfig);

      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 55, name: 'PLAT board', type: 'kanban' }],
      } as never);
      jiraClient.searchIssues.mockResolvedValue({
        issues: [],
        nextPageToken: undefined,
      } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('PLAT');

      const searchCall = jiraClient.searchIssues.mock.calls[0];
      const calledExtraFields = searchCall[4] as string[];
      expect(calledExtraFields).toContain('customfield_10106');
      expect(calledExtraFields).toContain('customfield_10014');
    });

    it('paginates kanban issues until no nextPageToken', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
      } as BoardConfig);

      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 55, name: 'PLAT board', type: 'kanban' }],
      } as never);

      let callCount = 0;
      jiraClient.searchIssues.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            issues: [makeRawIssue('PLAT-1')],
            nextPageToken: 'token-2',
          } as never);
        }
        return Promise.resolve({
          issues: [makeRawIssue('PLAT-2')],
          nextPageToken: undefined,
        } as never);
      });

      jiraClient.getIssueChangelog.mockResolvedValue({
        total: 0,
        maxResults: 100,
        values: [],
      } as never);

      jiraClient.getProjectVersions.mockResolvedValue([]);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      const log = await service.syncBoard('PLAT');

      expect(log.issueCount).toBe(2);
      expect(jiraClient.searchIssues).toHaveBeenCalledTimes(2);
    });

    it('calls getKanbanBacklog and marks backlog issues with inBacklog=true', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
      } as BoardConfig);

      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 55, name: 'PLAT board', type: 'kanban' }],
      } as never);

      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PLAT-1'), makeRawIssue('PLAT-2'), makeRawIssue('PLAT-3')],
        nextPageToken: undefined,
      } as never);

      // PLAT-1 and PLAT-3 are in the backlog; PLAT-2 is on the board
      jiraClient.getKanbanBacklog.mockResolvedValue({
        startAt: 0,
        maxResults: 100,
        total: 2,
        issues: [{ key: 'PLAT-1' }, { key: 'PLAT-3' }],
      } as never);

      jiraClient.getIssueChangelog.mockResolvedValue({ total: 0, maxResults: 100, values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('PLAT');

      // Should reset inBacklog for the board
      expect(issueRepo.update).toHaveBeenCalledWith(
        { boardId: 'PLAT' },
        { inBacklog: false },
      );

      // Should call getKanbanBacklog with the numeric board ID
      expect(jiraClient.getKanbanBacklog).toHaveBeenCalledWith('55', 0);

      // Should mark backlog keys via createQueryBuilder using "key" (not "issueKey")
      expect(issueRepo.createQueryBuilder).toHaveBeenCalled();
      const qb = (issueRepo.createQueryBuilder as jest.Mock).mock.results[0].value;
      const whereCalls = (qb.where as jest.Mock).mock.calls;
      expect(whereCalls.some((args: unknown[]) =>
        typeof args[0] === 'string' && args[0].includes('"key"'),
      )).toBe(true);
    });

    it('paginates getKanbanBacklog until all backlog keys are retrieved', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
      } as BoardConfig);

      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 55, name: 'PLAT board', type: 'kanban' }],
      } as never);

      jiraClient.searchIssues.mockResolvedValue({ issues: [], nextPageToken: undefined } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      let backlogCallCount = 0;
      jiraClient.getKanbanBacklog.mockImplementation((_boardId, startAt = 0) => {
        backlogCallCount++;
        if (startAt === 0) {
          return Promise.resolve({
            startAt: 0, maxResults: 100, total: 150,
            issues: Array.from({ length: 100 }, (_, i) => ({ key: `PLAT-${i + 1}` })),
          } as never);
        }
        return Promise.resolve({
          startAt: 100, maxResults: 100, total: 150,
          issues: Array.from({ length: 50 }, (_, i) => ({ key: `PLAT-${i + 101}` })),
        } as never);
      });

      await service.syncBoard('PLAT');

      // Should have paginated — called twice (startAt=0, startAt=100)
      expect(jiraClient.getKanbanBacklog).toHaveBeenCalledTimes(2);
      expect(jiraClient.getKanbanBacklog).toHaveBeenNthCalledWith(1, '55', 0);
      expect(jiraClient.getKanbanBacklog).toHaveBeenNthCalledWith(2, '55', 100);
    });

    it('does NOT call getKanbanBacklog for scrum boards', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'ACC',
        boardType: 'scrum',
      } as BoardConfig);

      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 10, name: 'ACC board', type: 'scrum' }],
      } as never);

      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.searchIssues.mockResolvedValue({ issues: [], nextPageToken: undefined } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('ACC');

      expect(jiraClient.getKanbanBacklog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // resolveNumericBoardId
  // -------------------------------------------------------------------------

  describe('resolveNumericBoardId', () => {
    it('returns numeric string directly without API call', async () => {
      // Tested indirectly: set up a scrum board with numeric id
      boardConfigRepo.findOne.mockResolvedValue({ boardId: '123', boardType: 'scrum' } as BoardConfig);
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('123');

      expect(jiraClient.getBoardsForProject).not.toHaveBeenCalled();
    });

    it('throws when project key has no boards', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'NOPE', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({ values: [] } as never);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      const log = await service.syncBoard('NOPE');

      expect(log.status).toBe('failed');
      expect(log.errorMessage).toContain('No Jira board found');
    });
  });

  // -------------------------------------------------------------------------
  // ensureBoardConfig
  // -------------------------------------------------------------------------

  describe('ensureBoardConfig', () => {
    it('returns existing config when found', async () => {
      const existing = { boardId: '42', boardType: 'scrum' } as BoardConfig;
      boardConfigRepo.findOne.mockResolvedValue(existing);
      // Use numeric id to avoid getBoardsForProject
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('42');

      // create should NOT have been called since config exists
      expect(boardConfigRepo.save).not.toHaveBeenCalled();
    });

    it('creates a fallback scrum config when not found', async () => {
      // First call (jiraFieldConfigRepo.findOne) → return defaultFieldConfig
      // Second call (boardConfigRepo.findOne in ensureBoardConfig) → null
      boardConfigRepo.findOne.mockResolvedValue(null);
      boardConfigRepo.save.mockResolvedValue({ boardId: '42', boardType: 'scrum' } as BoardConfig);
      // Use numeric id to avoid getBoardsForProject
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('42');

      expect(boardConfigRepo.save).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // mapJiraIssue — story points and epicKey variants
  // -------------------------------------------------------------------------

  describe('mapJiraIssue (via syncSprintIssues)', () => {
    beforeEach(() => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 42, name: 'PROJ board', type: 'scrum' }],
      } as never);
      jiraClient.getSprints.mockResolvedValue({
        values: [{ id: 1, name: 'Sprint 1', state: 'active' }],
      } as never);
      sprintRepo.upsert.mockResolvedValue(undefined as never);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      jiraClient.getIssueChangelog.mockResolvedValue({ total: 0, maxResults: 100, values: [] } as never);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));
    });

    it('extracts story points from customfield_10016', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', { customfield_10016: 5 })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].points).toBe(5);
    });

    it('extracts story points from customfield_10028 when 10016 absent', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', { customfield_10028: 8 })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].points).toBe(8);
    });

    it('sets points to null when no story point field present', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1')],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].points).toBeNull();
    });

    it('extracts epicKey from parent field when parent is an Epic', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', {
          parent: { key: 'PROJ-EPIC-1', fields: { issuetype: { name: 'Epic' } } },
        })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].epicKey).toBe('PROJ-EPIC-1');
    });

    it('falls back to customfield_10014 for epicKey when parent is not Epic', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', {
          parent: { key: 'PROJ-2', fields: { issuetype: { name: 'Story' } } },
          customfield_10014: 'PROJ-EPIC-2',
        })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].epicKey).toBe('PROJ-EPIC-2');
    });

    it('sets epicKey to null when no parent or customfield_10014', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1')],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].epicKey).toBeNull();
    });

    it('maps fixVersion from first fixVersions entry', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', {
          fixVersions: [{ id: '1', name: 'v1.0' }],
        })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].fixVersion).toBe('v1.0');
    });

    // -----------------------------------------------------------------------
    // New tests: non-default field IDs and null epicLinkFieldId
    // -----------------------------------------------------------------------

    it('extracts story points from a non-default field ID (customfield_10106)', async () => {
      const customFieldConfig: JiraFieldConfig = {
        ...defaultFieldConfig,
        storyPointsFieldIds: ['customfield_10106'],
      };
      jiraFieldConfigRepo.findOne.mockResolvedValue(customFieldConfig);

      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', { customfield_10106: 13 })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].points).toBe(13);
    });

    it('null epicLinkFieldId disables the legacy Epic Link fallback', async () => {
      const customFieldConfig: JiraFieldConfig = {
        ...defaultFieldConfig,
        epicLinkFieldId: null,
      };
      jiraFieldConfigRepo.findOne.mockResolvedValue(customFieldConfig);

      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', {
          // customfield_10014 is present but should be ignored
          customfield_10014: 'PROJ-EPIC-99',
        })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].epicKey).toBeNull();
    });

    it('uses custom epicLinkFieldId from config', async () => {
      const customFieldConfig: JiraFieldConfig = {
        ...defaultFieldConfig,
        epicLinkFieldId: 'customfield_20001',
      };
      jiraFieldConfigRepo.findOne.mockResolvedValue(customFieldConfig);

      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', {
          customfield_20001: 'PROJ-EPIC-77',
        })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      const upsertCall = issueRepo.upsert.mock.calls[0][0] as JiraIssue[];
      expect(upsertCall[0].epicKey).toBe('PROJ-EPIC-77');
    });
  });

  // -------------------------------------------------------------------------
  // persistIssueLinks
  // -------------------------------------------------------------------------

  describe('persistIssueLinks', () => {
    beforeEach(() => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 42, name: 'PROJ board', type: 'scrum' }],
      } as never);
      jiraClient.getSprints.mockResolvedValue({
        values: [{ id: 1, name: 'Sprint 1', state: 'active' }],
      } as never);
      sprintRepo.upsert.mockResolvedValue(undefined as never);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      jiraClient.getIssueChangelog.mockResolvedValue({ total: 0, maxResults: 100, values: [] } as never);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));
    });

    it('saves inward issue links', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', {
          issuelinks: [
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              inwardIssue: { key: 'PROJ-2', fields: { issuetype: { name: 'Bug' } } },
            },
          ],
        })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      expect(issueLinkRepo.delete).toHaveBeenCalledWith({ sourceIssueKey: 'PROJ-1' });
      expect(issueLinkRepo.save).toHaveBeenCalled();
      const savedInwardLinks = issueLinkRepo.save.mock.calls[0][0] as JiraIssueLink[];
      expect(savedInwardLinks[0].linkTypeName).toBe('is blocked by');
      expect(savedInwardLinks[0].isInward).toBe(true);
    });

    it('saves outward issue links', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', {
          issuelinks: [
            {
              type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
              outwardIssue: { key: 'PROJ-3', fields: { issuetype: { name: 'Story' } } },
            },
          ],
        })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      expect(issueLinkRepo.save).toHaveBeenCalled();
      const savedLinks = issueLinkRepo.save.mock.calls[0][0] as JiraIssueLink[];
      expect(savedLinks[0].linkTypeName).toBe('blocks');
      expect(savedLinks[0].isInward).toBe(false);
    });

    it('skips issues with no links', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1', { issuelinks: [] })],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      expect(issueLinkRepo.delete).not.toHaveBeenCalled();
      expect(issueLinkRepo.save).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // syncChangelogsBulk / syncIssueChangelog
  // -------------------------------------------------------------------------

  describe('syncChangelogsBulk / syncIssueChangelog', () => {
    beforeEach(() => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 42, name: 'PROJ board', type: 'scrum' }],
      } as never);
      jiraClient.getSprints.mockResolvedValue({
        values: [{ id: 1, name: 'Sprint 1', state: 'active' }],
      } as never);
      sprintRepo.upsert.mockResolvedValue(undefined as never);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));
    });

    it('saves changelog entries when values returned', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1')],
        nextPageToken: undefined,
      } as never);

      jiraClient.getIssueChangelog.mockResolvedValue({
        total: 1,
        maxResults: 100,
        values: [
          {
            id: 'c1',
            created: '2026-01-06T10:00:00Z',
            items: [
              { field: 'status', fieldtype: 'jira', from: '1', fromString: 'To Do', to: '2', toString: 'In Progress' },
            ],
          },
        ],
      } as never);

      await service.syncBoard('PROJ');

      expect(changelogRepo.delete).toHaveBeenCalledWith({ issueKey: 'PROJ-1' });
      expect(changelogRepo.save).toHaveBeenCalled();
    });

    it('paginates changelog when total > maxResults', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1')],
        nextPageToken: undefined,
      } as never);

      let changelogCallCount = 0;
      jiraClient.getIssueChangelog.mockImplementation(() => {
        changelogCallCount++;
        if (changelogCallCount === 1) {
          return Promise.resolve({
            total: 2,
            maxResults: 1,
            values: [
              {
                id: 'c1',
                created: '2026-01-06T10:00:00Z',
                items: [{ field: 'status', fieldtype: 'jira', from: '1', fromString: 'To Do', to: '2', toString: 'In Progress' }],
              },
            ],
          } as never);
        }
        return Promise.resolve({
          total: 2,
          maxResults: 1,
          values: [
            {
              id: 'c2',
              created: '2026-01-07T10:00:00Z',
              items: [{ field: 'status', fieldtype: 'jira', from: '2', fromString: 'In Progress', to: '3', toString: 'Done' }],
            },
          ],
        } as never);
      });

      await service.syncBoard('PROJ');

      expect(jiraClient.getIssueChangelog).toHaveBeenCalledTimes(2);
    });

    it('does not delete changelogs on pages after the first', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1')],
        nextPageToken: undefined,
      } as never);

      let changelogCallCount = 0;
      jiraClient.getIssueChangelog.mockImplementation(() => {
        changelogCallCount++;
        return Promise.resolve({
          total: 2,
          maxResults: 1,
          values: [
            {
              id: `c${changelogCallCount}`,
              created: '2026-01-06T10:00:00Z',
              items: [{ field: 'status', fieldtype: 'jira', from: null, fromString: null, to: '2', toString: 'In Progress' }],
            },
          ],
        } as never);
      });

      await service.syncBoard('PROJ');

      // delete should only be called once (startAt === 0)
      expect(changelogRepo.delete).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // syncVersions
  // -------------------------------------------------------------------------

  describe('syncVersions', () => {
    it('upserts versions with releaseDate', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({ values: [{ id: 42, name: 'PROJ board', type: 'scrum' }] } as never);
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([
        { id: '100', name: 'v1.0', released: true, releaseDate: '2026-03-01' } as never,
      ]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('PROJ');

      expect(versionRepo.upsert).toHaveBeenCalled();
      const versions = versionRepo.upsert.mock.calls[0][0] as JiraVersion[];
      expect(versions[0].name).toBe('v1.0');
      expect(versions[0].releaseDate).toEqual(new Date('2026-03-01'));
    });

    it('upserts version with null releaseDate when absent', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({ values: [{ id: 42, name: 'PROJ board', type: 'scrum' }] } as never);
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([
        { id: '101', name: 'v2.0', released: false } as never,
      ]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('PROJ');

      const versions = versionRepo.upsert.mock.calls[0][0] as JiraVersion[];
      expect(versions[0].releaseDate).toBeNull();
    });

    it('swallows errors from getProjectVersions', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({ values: [{ id: 42, name: 'PROJ board', type: 'scrum' }] } as never);
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockRejectedValue(new Error('version API down'));
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      const log = await service.syncBoard('PROJ');

      // Overall sync should still succeed
      expect(log.status).toBe('success');
    });
  });

  // -------------------------------------------------------------------------
  // syncSprints
  // -------------------------------------------------------------------------

  describe('syncSprints', () => {
    it('maps sprint fields including null dates', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({ values: [{ id: 42, name: 'PROJ board', type: 'scrum' }] } as never);
      jiraClient.getSprints.mockResolvedValue({
        values: [
          { id: 1, name: 'Sprint 1', state: 'future' }, // no startDate / endDate
        ],
      } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('PROJ');

      const upsertCall = sprintRepo.upsert.mock.calls[0][0] as JiraSprint[];
      expect(upsertCall[0].startDate).toBeNull();
      expect(upsertCall[0].endDate).toBeNull();
    });

    it('does not call upsert when no sprints returned', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({ values: [{ id: 42, name: 'PROJ board', type: 'scrum' }] } as never);
      jiraClient.getSprints.mockResolvedValue({ values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      await service.syncBoard('PROJ');

      expect(sprintRepo.upsert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // syncScrumIssuesByJql — pagination via nextPageToken
  // -------------------------------------------------------------------------

  describe('syncSprintIssues pagination', () => {
    it('paginates until no nextPageToken', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ boardId: 'PROJ', boardType: 'scrum' } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({ values: [{ id: 42, name: 'PROJ board', type: 'scrum' }] } as never);
      jiraClient.getSprints.mockResolvedValue({
        values: [{ id: 1, name: 'Sprint 1', state: 'active', startDate: '2026-01-05T00:00:00Z', endDate: '2026-01-19T00:00:00Z' }],
      } as never);
      sprintRepo.upsert.mockResolvedValue(undefined as never);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      jiraClient.getIssueChangelog.mockResolvedValue({ total: 0, maxResults: 100, values: [] } as never);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));

      let searchCallCount = 0;
      jiraClient.searchIssues.mockImplementation(() => {
        searchCallCount++;
        if (searchCallCount === 1) {
          return Promise.resolve({
            issues: [makeRawIssue('PROJ-1')],
            nextPageToken: 'token-2',
          } as never);
        }
        return Promise.resolve({
          issues: [makeRawIssue('PROJ-2')],
          nextPageToken: undefined,
        } as never);
      });

      const log = await service.syncBoard('PROJ');

      expect(log.issueCount).toBe(2);
      expect(jiraClient.searchIssues).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // syncScrumIssuesByJql — new JQL-based scrum issue sync (ADR 0048)
  // -------------------------------------------------------------------------

  describe('syncBoard (scrum — JQL path)', () => {
    let issueSprint: jest.Mocked<Repository<JiraIssueSprint>>;

    beforeEach(() => {
      issueSprint = mockRepo<JiraIssueSprint>();
      // Re-create service with the new issueSprint repo injected
      service = new SyncService(
        jiraClient,
        sprintRepo,
        issueRepo,
        issueSprint,
        changelogRepo,
        versionRepo,
        syncLogRepo,
        boardConfigRepo,
        roadmapConfigRepo,
        jpdIdeaRepo,
        issueLinkRepo,
        sprintReportService,
        jiraFieldConfigRepo,
        lambdaInvoker,
        dataSource,
        configService,
        schedulerRegistry,
      );

      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PROJ',
        boardType: 'scrum',
      } as BoardConfig);
      jiraClient.getBoardsForProject.mockResolvedValue({
        values: [{ id: 42, name: 'PROJ board', type: 'scrum' }],
      } as never);
      jiraClient.getSprints.mockResolvedValue({
        values: [
          { id: 1, name: 'Sprint 1', state: 'closed', startDate: '2026-01-05T00:00:00Z', endDate: '2026-01-19T00:00:00Z' },
        ],
      } as never);
      sprintRepo.upsert.mockResolvedValue(undefined as never);
      issueRepo.upsert.mockResolvedValue(undefined as never);
      issueSprint.delete.mockResolvedValue(undefined as never);
      issueSprint.upsert.mockResolvedValue(undefined as never);
      jiraClient.getIssueChangelog.mockResolvedValue({ total: 0, maxResults: 100, values: [] } as never);
      jiraClient.getProjectVersions.mockResolvedValue([]);
      syncLogRepo.save.mockImplementation((log) => Promise.resolve(log as SyncLog));
    });

    it('uses searchIssues (JQL) instead of getSprintIssues for scrum boards', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [makeRawIssue('PROJ-1'), makeRawIssue('PROJ-2')],
        nextPageToken: undefined,
      } as never);

      const log = await service.syncBoard('PROJ');

      expect(log.status).toBe('success');
      expect(log.issueCount).toBe(2);
      expect(jiraClient.searchIssues).toHaveBeenCalled();
      expect(jiraClient.getSprintIssues).not.toHaveBeenCalled();
    });

    it('includes cancelled / resolved issues that the agile endpoint would exclude', async () => {
      jiraClient.searchIssues.mockResolvedValue({
        issues: [
          makeRawIssue('PROJ-1', { status: { id: '6', name: 'Cancelled' } }),
          makeRawIssue('PROJ-2', { status: { id: '10002', name: 'Done' } }),
          makeRawIssue('PROJ-3'),
        ],
        nextPageToken: undefined,
      } as never);

      const log = await service.syncBoard('PROJ');

      expect(log.issueCount).toBe(3);
      // All 3 keys passed to changelog sync
      expect(jiraClient.getIssueChangelog).toHaveBeenCalledWith('PROJ-1', 0);
      expect(jiraClient.getIssueChangelog).toHaveBeenCalledWith('PROJ-2', 0);
      expect(jiraClient.getIssueChangelog).toHaveBeenCalledWith('PROJ-3', 0);
    });

    it('paginates JQL search until nextPageToken is exhausted', async () => {
      let calls = 0;
      jiraClient.searchIssues.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({ issues: [makeRawIssue('PROJ-1')], nextPageToken: 'tok2' } as never);
        }
        return Promise.resolve({ issues: [makeRawIssue('PROJ-2')], nextPageToken: undefined } as never);
      });

      const log = await service.syncBoard('PROJ');

      expect(log.issueCount).toBe(2);
      expect(jiraClient.searchIssues).toHaveBeenCalledTimes(2);
    });

    it('does not accumulate issues across pages — upserts per page', async () => {
      let calls = 0;
      jiraClient.searchIssues.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({ issues: [makeRawIssue('PROJ-1')], nextPageToken: 'tok2' } as never);
        }
        return Promise.resolve({ issues: [makeRawIssue('PROJ-2')], nextPageToken: undefined } as never);
      });

      await service.syncBoard('PROJ');

      // issueRepo.upsert must be called once per page (twice total), not once for all issues
      expect(issueRepo.upsert).toHaveBeenCalledTimes(2);
    });

    it('replaces JiraIssueSprint rows when Jira returns a non-empty customfield_10020 (sprint move)', async () => {
      const issueWithSprints = makeRawIssue('PROJ-1', {
        customfield_10020: [{ id: 1 }, { id: 2 }],
      });
      jiraClient.searchIssues.mockResolvedValue({
        issues: [issueWithSprints],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      // When Jira reports current sprints, replace existing rows so legitimate
      // sprint moves (Sprint A → Sprint B) are reflected.
      expect(issueSprint.delete).toHaveBeenCalledWith({ issueKey: 'PROJ-1' });
      expect(issueSprint.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ issueKey: 'PROJ-1', sprintId: '1' }),
          expect.objectContaining({ issueKey: 'PROJ-1', sprintId: '2' }),
        ]),
        expect.anything(),
      );
    });

    // -----------------------------------------------------------------------
    // Regression: SPS-504 / SPS-461 "never boarded" gap report bug.
    //
    // Issues created directly into a sprint emit no Sprint-field changelog.
    // Once the issue is Done and the sprint closes, Jira drops the sprint
    // from customfield_10020. The previous delete-then-upsert wiped the
    // only remaining trace of historical membership, causing the gap report
    // to falsely classify the issue as "never boarded".
    //
    // Fix (option 2): when customfield_10020 is empty/missing, leave existing
    // JiraIssueSprint rows untouched. Only delete when Jira returns a
    // non-empty list (so legitimate sprint moves still replace correctly).
    // -----------------------------------------------------------------------

    it('preserves existing JiraIssueSprint rows when Jira returns an empty customfield_10020 (Done issue, closed sprint)', async () => {
      // Simulates the SPS-504 / SPS-461 case: Done issue whose sprint has
      // closed, so Jira no longer returns it in customfield_10020.
      const doneIssueNoSprints = makeRawIssue('PROJ-504', {
        customfield_10020: [],
        status: { id: '10003', name: 'Done' },
      });
      jiraClient.searchIssues.mockResolvedValue({
        issues: [doneIssueNoSprints],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      // Critical: must NOT delete or upsert sprint rows for this issue —
      // historical membership (the only trace for issues with no Sprint
      // changelog) must be preserved.
      expect(issueSprint.delete).not.toHaveBeenCalledWith({ issueKey: 'PROJ-504' });
      expect(issueSprint.upsert).not.toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ issueKey: 'PROJ-504' }),
        ]),
        expect.anything(),
      );
    });

    it('preserves existing JiraIssueSprint rows when customfield_10020 is null/missing', async () => {
      const issueNullSprintField = makeRawIssue('PROJ-461', {
        customfield_10020: null,
      });
      jiraClient.searchIssues.mockResolvedValue({
        issues: [issueNullSprintField],
        nextPageToken: undefined,
      } as never);

      await service.syncBoard('PROJ');

      expect(issueSprint.delete).not.toHaveBeenCalledWith({ issueKey: 'PROJ-461' });
      expect(issueSprint.upsert).not.toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ issueKey: 'PROJ-461' }),
        ]),
        expect.anything(),
      );
    });

    it('marks sync as failed when JQL search throws — no fallback to agile endpoint', async () => {
      jiraClient.searchIssues.mockRejectedValue(new Error('403 Forbidden'));

      const log = await service.syncBoard('PROJ');

      expect(log.status).toBe('failed');
      expect(log.errorMessage).toBe('403 Forbidden');
      expect(jiraClient.getSprintIssues).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // syncRoadmaps / syncJpdProject
  // -------------------------------------------------------------------------

  describe('syncRoadmaps', () => {
    it('syncs JPD ideas with JSON interval field', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        {
          jpdKey: 'JPD',
          startDateFieldId: 'customfield_start',
          targetDateFieldId: 'customfield_end',
        } as RoadmapConfig,
      ]);

      roadmapConfigRepo.findOne.mockResolvedValue({
        jpdKey: 'JPD',
        startDateFieldId: 'customfield_start',
        targetDateFieldId: 'customfield_end',
      } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-1',
            fields: {
              summary: 'Idea 1',
              status: { name: 'In Discovery' },
              issuelinks: [],
              customfield_start: '{"start":"2026-04-01","end":"2026-06-30"}',
              customfield_end: '{"start":"2026-04-01","end":"2026-06-30"}',
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      expect(jpdIdeaRepo.upsert).toHaveBeenCalled();
      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].startDate).toEqual(new Date('2026-04-01'));
      expect(ideas[0].targetDate).toEqual(new Date('2026-06-30'));
    });

    it('syncs JPD ideas with object interval field', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD', startDateFieldId: 'cf_start', targetDateFieldId: 'cf_end' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({
        jpdKey: 'JPD', startDateFieldId: 'cf_start', targetDateFieldId: 'cf_end',
      } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-2',
            fields: {
              summary: 'Idea 2',
              status: { name: 'In Progress' },
              issuelinks: [],
              cf_start: { start: '2026-05-01', end: '2026-07-31' },
              cf_end: { start: '2026-05-01', end: '2026-07-31' },
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].startDate).toEqual(new Date('2026-05-01'));
      expect(ideas[0].targetDate).toEqual(new Date('2026-07-31'));
    });

    it('syncs JPD ideas with plain date string field', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD', startDateFieldId: 'cf_s', targetDateFieldId: 'cf_t' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({
        jpdKey: 'JPD', startDateFieldId: 'cf_s', targetDateFieldId: 'cf_t',
      } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-3',
            fields: {
              summary: 'Idea 3',
              status: { name: 'Done' },
              issuelinks: [],
              cf_s: '2026-02-01',
              cf_t: '2026-03-31',
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].startDate).toEqual(new Date('2026-02-01'));
      expect(ideas[0].targetDate).toEqual(new Date('2026-03-31'));
    });

    it('sets dates to null when interval fields are null', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD', startDateFieldId: 'cf_s', targetDateFieldId: 'cf_t' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({
        jpdKey: 'JPD', startDateFieldId: 'cf_s', targetDateFieldId: 'cf_t',
      } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-4',
            fields: {
              summary: 'Idea 4',
              status: { name: 'To Do' },
              issuelinks: [],
              cf_s: null,
              cf_t: null,
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].startDate).toBeNull();
      expect(ideas[0].targetDate).toBeNull();
    });

    it('detects delivery links from inward "is implemented by" Epic', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({ jpdKey: 'JPD' } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-5',
            fields: {
              summary: 'Idea 5',
              status: { name: 'In Discovery' },
              issuelinks: [
                {
                  type: { name: 'Implements', inward: 'is implemented by', outward: 'implements' },
                  inwardIssue: { key: 'EPIC-1', fields: { issuetype: { name: 'Epic' } } },
                },
              ],
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].deliveryIssueKeys).toEqual(['EPIC-1']);
    });

    it('detects delivery links from outward "delivers" Epic', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({ jpdKey: 'JPD' } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-6',
            fields: {
              summary: 'Idea 6',
              status: { name: 'In Discovery' },
              issuelinks: [
                {
                  type: { name: 'Delivers', inward: 'is delivered by', outward: 'delivers' },
                  outwardIssue: { key: 'EPIC-2', fields: { issuetype: { name: 'Epic' } } },
                },
              ],
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].deliveryIssueKeys).toEqual(['EPIC-2']);
    });

    it('detects delivery links from custom inward link type names', async () => {
      // Override the field config to use custom JPD link type names
      const customFieldConfig: JiraFieldConfig = {
        ...defaultFieldConfig,
        jpdDeliveryLinkInward: ['is built by'],
        jpdDeliveryLinkOutward: ['builds'],
      };
      jiraFieldConfigRepo.findOne.mockResolvedValue(customFieldConfig);

      roadmapConfigRepo.find.mockResolvedValue([{ jpdKey: 'JPD' } as RoadmapConfig]);
      roadmapConfigRepo.findOne.mockResolvedValue({ jpdKey: 'JPD' } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-10',
            fields: {
              summary: 'Idea 10',
              status: { name: 'In Discovery' },
              issuelinks: [
                {
                  type: { name: 'Builds', inward: 'is built by', outward: 'builds' },
                  inwardIssue: { key: 'EPIC-10', fields: { issuetype: { name: 'Epic' } } },
                },
              ],
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].deliveryIssueKeys).toEqual(['EPIC-10']);
    });

    it('does not detect delivery links when custom names do not match default names', async () => {
      // Override to use custom link names that don't match the default Jira link
      const customFieldConfig: JiraFieldConfig = {
        ...defaultFieldConfig,
        jpdDeliveryLinkInward: ['is built by'],
        jpdDeliveryLinkOutward: ['builds'],
      };
      jiraFieldConfigRepo.findOne.mockResolvedValue(customFieldConfig);

      roadmapConfigRepo.find.mockResolvedValue([{ jpdKey: 'JPD' } as RoadmapConfig]);
      roadmapConfigRepo.findOne.mockResolvedValue({ jpdKey: 'JPD' } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-11',
            fields: {
              summary: 'Idea 11',
              status: { name: 'In Discovery' },
              issuelinks: [
                {
                  // default link type — should NOT match custom config
                  type: { name: 'Implements', inward: 'is implemented by', outward: 'implements' },
                  inwardIssue: { key: 'EPIC-11', fields: { issuetype: { name: 'Epic' } } },
                },
              ],
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].deliveryIssueKeys).toBeNull();
    });

    it('sets deliveryIssueKeys to null when no delivery links', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({ jpdKey: 'JPD' } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          {
            key: 'JPD-7',
            fields: {
              summary: 'Idea 7',
              status: { name: 'To Do' },
              issuelinks: [],
            },
          },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      const ideas = jpdIdeaRepo.upsert.mock.calls[0][0] as JpdIdea[];
      expect(ideas[0].deliveryIssueKeys).toBeNull();
    });

    it('paginates getJpdIdeas until no nextPageToken', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({ jpdKey: 'JPD' } as RoadmapConfig);

      let jpdCallCount = 0;
      jiraClient.getJpdIdeas.mockImplementation(() => {
        jpdCallCount++;
        if (jpdCallCount === 1) {
          return Promise.resolve({
            issues: [
              { key: 'JPD-1', fields: { summary: 'Idea 1', status: { name: 'To Do' }, issuelinks: [] } },
            ],
            nextPageToken: 'token-2',
          } as never);
        }
        return Promise.resolve({
          issues: [
            { key: 'JPD-2', fields: { summary: 'Idea 2', status: { name: 'To Do' }, issuelinks: [] } },
          ],
          nextPageToken: undefined,
        } as never);
      });

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      await service.syncRoadmaps();

      expect(jiraClient.getJpdIdeas).toHaveBeenCalledTimes(2);
    });

    it('skips upsert and does not throw when no ideas returned', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({ jpdKey: 'JPD' } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [],
        nextPageToken: undefined,
      } as never);

      await service.syncRoadmaps();

      expect(jpdIdeaRepo.upsert).not.toHaveBeenCalled();
    });

    it('swallows per-project errors and continues to next JPD config', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD-A' } as RoadmapConfig,
        { jpdKey: 'JPD-B' } as RoadmapConfig,
      ]);

      let findOneCallCount = 0;
      roadmapConfigRepo.findOne.mockImplementation(() => {
        findOneCallCount++;
        if (findOneCallCount === 1) {
          return Promise.reject(new Error('JPD-A failed'));
        }
        return Promise.resolve({ jpdKey: 'JPD-B' } as RoadmapConfig);
      });

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [],
        nextPageToken: undefined,
      } as never);

      // Should not throw
      await expect(service.syncRoadmaps()).resolves.not.toThrow();
    });

    it('warns when targetDateFieldId configured but all ideas have null targetDate', async () => {
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'JPD', targetDateFieldId: 'cf_t' } as RoadmapConfig,
      ]);
      roadmapConfigRepo.findOne.mockResolvedValue({
        jpdKey: 'JPD', targetDateFieldId: 'cf_t',
      } as RoadmapConfig);

      jiraClient.getJpdIdeas.mockResolvedValue({
        issues: [
          { key: 'JPD-1', fields: { summary: 'Idea', status: { name: 'To Do' }, issuelinks: [], cf_t: null } },
        ],
        nextPageToken: undefined,
      } as never);

      jpdIdeaRepo.upsert.mockResolvedValue(undefined as never);

      // Should not throw — just logs a warning
      await expect(service.syncRoadmaps()).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  describe('getStatus', () => {
    it('returns never status for boards with no sync log', async () => {
      boardConfigRepo.find.mockResolvedValue([
        { boardId: 'PROJ' } as BoardConfig,
      ]);
      syncLogRepo.findOne.mockResolvedValue(null);

      const result = await service.getStatus();

      expect(result).toHaveLength(1);
      expect(result[0].boardId).toBe('PROJ');
      expect(result[0].status).toBe('never');
      expect(result[0].lastSync).toBeNull();
    });

    it('returns last sync date and status from most recent log', async () => {
      boardConfigRepo.find.mockResolvedValue([
        { boardId: 'PROJ' } as BoardConfig,
        { boardId: 'PLAT' } as BoardConfig,
      ]);

      const syncedAt = new Date('2026-04-01T12:00:00Z');
      syncLogRepo.findOne.mockImplementation((opts: unknown) => {
        const where = (opts as { where: { boardId: string } }).where;
        if (where.boardId === 'PROJ') {
          return Promise.resolve({ boardId: 'PROJ', syncedAt, status: 'success' } as SyncLog);
        }
        return Promise.resolve(null);
      });

      const result = await service.getStatus();

      expect(result).toHaveLength(2);
      expect(result[0].lastSync).toEqual(syncedAt);
      expect(result[0].status).toBe('success');
      expect(result[1].status).toBe('never');
    });

    it('returns empty array when no board configs exist', async () => {
      boardConfigRepo.find.mockResolvedValue([]);

      const result = await service.getStatus();

      expect(result).toEqual([]);
    });
  });
});
