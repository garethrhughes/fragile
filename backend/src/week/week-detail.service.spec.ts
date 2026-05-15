import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { WeekDetailService } from './week-detail.service.js';
import {
  JiraIssue,
  JiraChangelog,
  BoardConfig,
  RoadmapConfig,
  JpdIdea,
  JiraIssueLink,
} from '../database/entities/index.js';
import { WorkingTimeService, type WorkingTimeConfig } from '../metrics/working-time.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function mockConfigService(jiraBaseUrl = '', timezone = 'UTC'): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation((_key: string, defaultVal?: unknown) => {
      if (_key === 'JIRA_BASE_URL') return jiraBaseUrl;
      if (_key === 'TIMEZONE') return timezone;
      return defaultVal ?? '';
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'PLAT-1',
    boardId: 'PLAT',
    issueType: 'Story',
    summary: 'Test issue',
    status: 'In Progress',
    labels: [],
    epicKey: null,
    fixVersion: null,
    sprintId: null,
    createdAt: new Date('2026-01-05T09:00:00Z'),
    priority: null,
    points: null,
    statusId: null,
    inBacklog: false,
    ...overrides,
  } as unknown as JiraIssue;
}

function makeChangelog(overrides: Partial<JiraChangelog> = {}): JiraChangelog {
  return {
    id: 1,
    issueKey: 'PLAT-1',
    field: 'status',
    fromValue: 'Backlog',    // entering the board from a pre-board state
    toValue: 'To Do',        // landing in a board-entry status
    changedAt: new Date('2026-01-05T09:00:00Z'),
    ...overrides,
  } as unknown as JiraChangelog;
}

function mockWorkingTimeService(): jest.Mocked<WorkingTimeService> {
  const DEFAULT_WT_CONFIG: WorkingTimeConfig = {
    timezone: 'UTC',
    workDays: [1, 2, 3, 4, 5],
    hoursPerDay: 8,
    holidays: [],
  };
  return {
    getConfig: jest.fn().mockResolvedValue({}),
    toConfig: jest.fn().mockReturnValue(DEFAULT_WT_CONFIG),
    workingDaysBetween: jest.fn().mockImplementation(
      (start: Date, end: Date) =>
        Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    ),
  } as unknown as jest.Mocked<WorkingTimeService>;
}


const WEEK = '2026-W02';
const WEEK_START = new Date('2026-01-05T00:00:00.000Z');

describe('WeekDetailService', () => {
  let service: WeekDetailService;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let roadmapConfigRepo: jest.Mocked<Repository<RoadmapConfig>>;
  let jpdIdeaRepo: jest.Mocked<Repository<JpdIdea>>;
  let issueLinkRepo: jest.Mocked<Repository<JiraIssueLink>>;
  let workingTimeService: jest.Mocked<WorkingTimeService>;

  function kanbanConfig(overrides: object = {}): BoardConfig {
    return {
      boardId: 'PLAT',
      boardType: 'kanban',
      doneStatusNames: ['Done'],
      incidentIssueTypes: ['Bug', 'Incident'],
      incidentLabels: [],
      failureIssueTypes: ['Bug', 'Incident'],
      failureLabels: ['regression', 'incident', 'hotfix'],
      backlogStatusIds: [],
      dataStartDate: null,
      ...overrides,
    } as unknown as BoardConfig;
  }

  beforeEach(() => {
    issueRepo = mockRepo<JiraIssue>();
    changelogRepo = mockRepo<JiraChangelog>();
    boardConfigRepo = mockRepo<BoardConfig>();
    roadmapConfigRepo = mockRepo<RoadmapConfig>();
    jpdIdeaRepo = mockRepo<JpdIdea>();
    issueLinkRepo = mockRepo<JiraIssueLink>();
    workingTimeService = mockWorkingTimeService();

    service = new WeekDetailService(
      issueRepo,
      changelogRepo,
      boardConfigRepo,
      roadmapConfigRepo,
      jpdIdeaRepo,
      issueLinkRepo,
      mockConfigService(),
      workingTimeService,
    );
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  describe('getDetail — validation', () => {
    it('throws BadRequestException for invalid week format', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      await expect(service.getDetail('PLAT', 'not-a-week')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for scrum board', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'ACC',
        boardType: 'scrum',
      } as unknown as BoardConfig);
      await expect(service.getDetail('ACC', WEEK)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no board config (defaults to scrum)', async () => {
      boardConfigRepo.findOne.mockResolvedValue(null);
      await expect(service.getDetail('ACC', WEEK)).rejects.toThrow(BadRequestException);
    });
  });

  // -------------------------------------------------------------------------
  // Empty board
  // -------------------------------------------------------------------------

  describe('getDetail — empty board', () => {
    it('returns empty response when board has no issues', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.boardId).toBe('PLAT');
      expect(result.week).toBe(WEEK);
      expect(result.summary.totalIssues).toBe(0);
      expect(result.issues).toHaveLength(0);
    });

    it('excludes Epic issue type', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([makeIssue({ issueType: 'Epic' })]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeChangelog({ changedAt: new Date('2026-01-06T09:00:00Z') })]),
      });

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.totalIssues).toBe(0);
    });

    it('returns empty when no issues fall within the week', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      // Issue entered in a different week
      const toDoExitCl = makeChangelog({
        changedAt: new Date('2026-02-15T09:00:00Z'), // W07, not W02
      });
      issueRepo.find.mockResolvedValue([makeIssue()]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([toDoExitCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.totalIssues).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('getDetail — kanban happy path', () => {
    it('returns issue that entered the board in the given week', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: new Date('2026-01-06T09:00:00Z'), // W02
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.totalIssues).toBe(1);
      expect(result.issues[0].key).toBe('PLAT-1');
    });

    it('marks completedInWeek true for done transition within the week', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });
      const doneCl = makeChangelog({
        issueKey: 'PLAT-1',
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-01-08T09:00:00Z'),
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl, doneCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].completedInWeek).toBe(true);
    });

    it('marks addedMidWeek true for issue entering > 1 day after week start', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      // Jan 7 is > 1 day after Jan 5 (week start)
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: new Date('2026-01-07T09:00:00Z'),
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].addedMidWeek).toBe(true);
    });

    it('marks addedMidWeek false for issue entering at week start', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: WEEK_START, // exactly at week start
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].addedMidWeek).toBe(false);
    });

    it('marks isIncident true for Critical Bug', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', issueType: 'Bug', priority: 'Critical', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].isIncident).toBe(true);
    });

    it('marks isFailure true for issue with failure label', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', labels: ['regression'], createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].isFailure).toBe(true);
    });

    it('sets roadmapStatus when epicKey is in covered set', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', epicKey: 'EPIC-1', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([
        { id: 1, jpdKey: 'JPD-1', description: null, startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() } as RoadmapConfig,
      ]);
      jpdIdeaRepo.find.mockResolvedValue([
        { key: 'IDEA-1', jpdKey: 'JPD-1', deliveryIssueKeys: ['EPIC-1'], targetDate: new Date('2026-06-30T00:00:00Z') } as unknown as JpdIdea,
      ]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).not.toBe('none');
    });

    it('sets roadmapStatus via direct issue→idea link (Condition C)', async () => {
      // PLAT-1 has no epicKey but is directly linked to a JPD idea via a
      // configured roadmapLinkType — it should still be linked to roadmap.
      const config = kanbanConfig();
      (config as any).roadmapLinkTypes = ['is connected to'];
      boardConfigRepo.findOne.mockResolvedValue(config);
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', epicKey: null, createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([
        { id: 1, jpdKey: 'JPD-1', description: null, startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() } as RoadmapConfig,
      ]);
      const idea = { key: 'PT-1', jpdKey: 'JPD-1', deliveryIssueKeys: [], targetDate: new Date('2026-06-30T00:00:00Z') } as unknown as JpdIdea;
      jpdIdeaRepo.find.mockResolvedValue([idea]);
      // issueLinkRepo returns a link: PLAT-1 → PT-1 via 'is connected to'
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { sourceIssueKey: 'PLAT-1', targetIssueKey: 'PT-1', linkTypeName: 'is connected to' },
        ]),
      });

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).not.toBe('none');
    });

    it('builds jiraUrl when JIRA_BASE_URL is configured', async () => {
      const serviceWithUrl = new WeekDetailService(
        issueRepo,
        changelogRepo,
        boardConfigRepo,
        roadmapConfigRepo,
        jpdIdeaRepo,
        issueLinkRepo,
        mockConfigService('https://myorg.atlassian.net'),
        workingTimeService,
      );
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await serviceWithUrl.getDetail('PLAT', WEEK);
      expect(result.issues[0].jiraUrl).toBe('https://myorg.atlassian.net/browse/PLAT-1');
    });

    it('returns correct summary counts', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({
        issueKey: 'PLAT-1',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });
      const doneCl = makeChangelog({
        issueKey: 'PLAT-1',
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-01-08T09:00:00Z'),
      });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', points: 5, createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl, doneCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.totalIssues).toBe(1);
      expect(result.summary.completedIssues).toBe(1);
      expect(result.summary.totalPoints).toBe(5);
      expect(result.summary.completedPoints).toBe(5);
    });

    it('sorts incomplete issues before completed', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const cl1 = makeChangelog({ issueKey: 'PLAT-1', changedAt: new Date('2026-01-06T09:00:00Z') });
      const cl2 = makeChangelog({ issueKey: 'PLAT-2', changedAt: new Date('2026-01-06T09:00:00Z') });
      const doneCl2 = makeChangelog({ issueKey: 'PLAT-2', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-07T09:00:00Z') });

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-12-01T00:00:00Z') }),
        makeIssue({ key: 'PLAT-2', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([cl1, cl2, doneCl2]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].key).toBe('PLAT-1'); // incomplete first
      expect(result.issues[1].key).toBe('PLAT-2');
    });

    it('returns boardConfig in response', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.boardConfig.boardType).toBe('kanban');
      expect(result.boardConfig.doneStatusNames).toContain('Done');
    });

    it('falls back to createdAt when issue has no "To Do" exit changelog', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      // A non-"To Do" status transition (e.g. In Progress → Done)
      const otherCl = makeChangelog({
        issueKey: 'PLAT-1',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-01-06T09:00:00Z'),
      });

      // createdAt is in W02 so issue should be included
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2026-01-05T09:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([otherCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      // createdAt (Jan 5) is in W02, but no "To Do" exit → falls back to createdAt
      const result = await service.getDetail('PLAT', WEEK);
      // Note: the fallback boardEntryDate = createdAt = Jan 5, which is in W02
      expect(result.summary.totalIssues).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // B-3: incidentPriorities from BoardConfig
  // -------------------------------------------------------------------------

  describe('B-3: incidentPriorities from BoardConfig', () => {
    function setupB3(incidentPriorities: string[], issuePriority: string | null) {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        incidentIssueTypes: ['Bug'],
        incidentLabels: [],
        incidentPriorities,
        failureIssueTypes: ['Bug'],
        failureLabels: [],
        backlogStatusIds: [],
      } as unknown as BoardConfig);

      issueRepo.find.mockResolvedValue([
        makeIssue({
          key: 'PLAT-1',
          issueType: 'Bug',
          priority: issuePriority,
          createdAt: new Date('2026-01-05T09:00:00Z'),
        }),
      ]);

      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({
            issueKey: 'PLAT-1',
            field: 'status',
            fromValue: 'Backlog',
            toValue: 'To Do',
            changedAt: new Date('2026-01-05T09:00:00Z'),
          }),
        ]),
      });

      roadmapConfigRepo.find.mockResolvedValue([]);
      jpdIdeaRepo.find.mockResolvedValue([]);
    }

    it('Bug at Highest priority IS incident when incidentPriorities = [Highest]', async () => {
      setupB3(['Highest'], 'Highest');
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].isIncident).toBe(true);
    });

    it('Bug at Medium priority is NOT incident when incidentPriorities = [Highest]', async () => {
      setupB3(['Highest'], 'Medium');
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].isIncident).toBe(false);
    });

    it('Bug at any priority IS incident when incidentPriorities = [] (empty = all)', async () => {
      setupB3([], 'Low');
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].isIncident).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // failureLinkTypes AND-gate (Proposal 0032)
  // -------------------------------------------------------------------------

  describe('failureLinkTypes AND-gate', () => {
    /**
     * Sets up a kanban board with one Bug issue (PLAT-1) that entered the
     * board in W02 via a "To Do" exit changelog.  The issueLinkRepo mock
     * returns the given linkRows.
     */
    function setupLinkGateTest(
      failureLinkTypes: string[],
      linkRows: object[],
    ) {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        failureIssueTypes: ['Bug'],
        failureLabels: [],
        failureLinkTypes,
        incidentIssueTypes: [],
        incidentLabels: [],
        incidentPriorities: [],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', issueType: 'Bug', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);

      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({
            issueKey: 'PLAT-1',
            field: 'status',
            fromValue: 'Backlog',
            toValue: 'To Do',
            changedAt: new Date('2026-01-06T09:00:00Z'), // W02
          }),
        ]),
      });

      roadmapConfigRepo.find.mockResolvedValue([]);

      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(linkRows),
      });
    }

    it('does NOT mark as isFailure when failureLinkTypes is set and no matching link', async () => {
      setupLinkGateTest(['caused by'], []); // no causal links

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.issues[0].isFailure).toBe(false);
    });

    it('marks as isFailure when failureLinkTypes is set and matching link present', async () => {
      setupLinkGateTest(['caused by'], [{ key: 'PLAT-1' }]);

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.issues[0].isFailure).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // boardEntryDate alignment bug regression (PLAT/2026-W19)
  //
  // The overview (getKanbanWeeks) uses cl.toValue IN (boardEntryStatuses) to
  // find the first transition *into* a board-entry status.
  // The detail was using cl.fromValue === 'To Do' — a different direction and
  // hard-coded to a single status.  This caused the "1 ticket in overview,
  // 0 in detail" divergence for any issue whose first board-entry status was
  // not 'To Do' (e.g. entered directly from 'Backlog' or 'Open').
  // -------------------------------------------------------------------------

  describe('boardEntryDate — uses toValue IN (boardEntryStatuses), not fromValue', () => {
    function setupSingleCl(changelog: Partial<JiraChangelog>, createdAt: Date) {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([makeChangelog(changelog)]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);
    }

    it('includes issue that entered via "Backlog" → "In Progress" (toValue = "In Progress" is not a board-entry status; toValue = "To Do" triggers entry)', async () => {
      // Issue moved Backlog → To Do (enters the board) in W02.
      // Old code: looked for fromValue==='To Do' — would never find this transition.
      // New code: looks for toValue IN boardEntryStatuses — finds toValue='To Do'.
      setupSingleCl(
        { fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-06T09:00:00Z') },
        new Date('2025-11-01T00:00:00Z'), // createdAt well before W02
      );

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.summary.totalIssues).toBe(1);
      expect(result.issues[0].key).toBe('PLAT-1');
    });

    it('includes issue that entered via "Open" → "In Progress" when "Open" is a default boardEntryStatus', async () => {
      // toValue = 'Open' matches the default boardEntryStatuses list.
      setupSingleCl(
        { fromValue: 'Backlog', toValue: 'Open', changedAt: new Date('2026-01-07T10:00:00Z') },
        new Date('2025-10-01T00:00:00Z'),
      );

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.summary.totalIssues).toBe(1);
    });

    it('excludes issue when its board-entry status transition falls outside the week window', async () => {
      // toValue = 'To Do' but in a different week (W01).
      setupSingleCl(
        { fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2025-12-29T09:00:00Z') },
        new Date('2025-12-01T00:00:00Z'),
      );

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.summary.totalIssues).toBe(0);
    });

    it('falls back to createdAt when no boardEntryStatuses transition exists and createdAt is in the week', async () => {
      // Only a Done transition — no board-entry status match anywhere.
      // createdAt is in W02 → should be included via fallback.
      setupSingleCl(
        { fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-08T09:00:00Z') },
        new Date('2026-01-06T00:00:00Z'), // createdAt in W02
      );

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.summary.totalIssues).toBe(1);
    });

    it('uses boardConfig.boardEntryStatuses override instead of defaults', async () => {
      // Board is configured to use only 'Ready' as the entry status.
      boardConfigRepo.findOne.mockResolvedValue(
        kanbanConfig({ boardEntryStatuses: ['Ready'] }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-11-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ fromValue: 'Backlog', toValue: 'Ready', changedAt: new Date('2026-01-06T09:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.summary.totalIssues).toBe(1);
    });

    it('does NOT include issue that transitioned "To Do" → "In Progress" via old fromValue logic but has no toValue match in this week', async () => {
      // The old code matched fromValue === 'To Do'. The new code must NOT match
      // this transition as a board-entry event because toValue='In Progress' is
      // not in boardEntryStatuses.  The issue must fall back to createdAt.
      // We set createdAt outside the week so the issue should NOT appear.
      setupSingleCl(
        { fromValue: 'To Do', toValue: 'In Progress', changedAt: new Date('2026-01-06T09:00:00Z') },
        new Date('2025-11-01T00:00:00Z'), // createdAt outside W02
      );

      // With the new algorithm, toValue='In Progress' is NOT a board-entry status.
      // No board-entry transition found → falls back to createdAt (Nov 2025) → excluded.
      // BUT WAIT: old tests relied on fromValue==='To Do' finding this transition.
      // The new algorithm does NOT find this as an entry event.
      // The issue would be treated as not having a board-entry in W02 (createdAt is Nov 2025).
      const result = await service.getDetail('PLAT', WEEK);

      expect(result.summary.totalIssues).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Timezone-aware week window (regression for UTC vs configured timezone mismatch)
  //
  // The overview (getKanbanWeeks / dateToWeekKey) converts board-entry timestamps
  // to the configured TIMEZONE before determining which week they belong to.
  // The detail service was computing weekStart/weekEnd in pure UTC, so an issue
  // that entered the board at e.g. 14:30 UTC on Sunday 2026-05-03 would be
  // bucketed into W18 by the overview (AEST = UTC+10 → Monday 00:30 local) but
  // fall outside the UTC W18 window [2026-04-27..2026-05-03 23:59:59Z] by the
  // detail service, causing a count mismatch.
  // -------------------------------------------------------------------------

  describe('timezone-aware week window', () => {
    // 2026-W18: Monday 2026-04-27 – Sunday 2026-05-03 (UTC)
    // In Australia/Sydney (UTC+10), 2026-05-03T14:30:00Z is Monday 2026-05-04 00:30 AEST → W19
    // In Australia/Sydney, 2026-04-26T14:30:00Z is Monday 2026-04-27 00:30 AEST → W18 ✓

    function setupTzService(timezone: string) {
      service = new WeekDetailService(
        issueRepo,
        changelogRepo,
        boardConfigRepo,
        roadmapConfigRepo,
        jpdIdeaRepo,
        issueLinkRepo,
        mockConfigService('', timezone),
        workingTimeService,
      );
    }

    it('includes issue whose board-entry timestamp is in W19 local time (Australia/Sydney) when querying W19', async () => {
      // 2026-05-03T14:30:00Z = 2026-05-04T00:30:00+10:00 → Monday of W19 in AEST
      // The detail service must use tz-aware boundaries for 2026-W19 so this issue is included.
      setupTzService('Australia/Sydney');
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-99', createdAt: new Date('2026-04-01T00:00:00Z') }),
      ]);
      const entryChangelog = makeChangelog({
        issueKey: 'PLAT-99',
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: new Date('2026-05-03T14:30:00Z'), // 00:30 Mon local = W19 in AEST
      });
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entryChangelog]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', '2026-W19');

      expect(result.summary.totalIssues).toBe(1);
    });

    it('excludes issue whose board-entry timestamp is in W19 local time (Australia/Sydney) when querying W18', async () => {
      // Same timestamp as above — must NOT appear in W18 when tz is Australia/Sydney.
      setupTzService('Australia/Sydney');
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-99', createdAt: new Date('2026-04-01T00:00:00Z') }),
      ]);
      const entryChangelog = makeChangelog({
        issueKey: 'PLAT-99',
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: new Date('2026-05-03T14:30:00Z'), // 00:30 Mon local = W19 in AEST, NOT W18
      });
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entryChangelog]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', '2026-W18');

      expect(result.summary.totalIssues).toBe(0);
    });

    it('includes issue in W18 (Australia/Sydney) when board-entry is late Sunday UTC but still Saturday local', async () => {
      // 2026-05-03T10:00:00Z = 2026-05-03T20:00:00+10:00 → Sunday evening AEST = still W18
      // UTC boundary: 2026-05-03T23:59:59Z = end of W18 UTC, but in AEST this is W18 too (Monday 09:59)
      // Use a timestamp that is in W18 UTC AND W18 AEST to confirm inclusion in W18.
      setupTzService('Australia/Sydney');
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-88', createdAt: new Date('2026-04-01T00:00:00Z') }),
      ]);
      const entryChangelog = makeChangelog({
        issueKey: 'PLAT-88',
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: new Date('2026-05-03T10:00:00Z'), // 20:00 Sun AEST = W18 local
      });
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entryChangelog]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', '2026-W18');

      expect(result.summary.totalIssues).toBe(1);
    });

    it('uses UTC week window when TIMEZONE is UTC (no change in behaviour)', async () => {
      // UTC: W02 2026 starts 2026-01-05T00:00:00Z, ends 2026-01-11T23:59:59.999Z
      setupTzService('UTC');
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', createdAt: new Date('2025-11-01T00:00:00Z') }),
      ]);
      const entryChangelog = makeChangelog({
        fromValue: 'Backlog',
        toValue: 'To Do',
        changedAt: new Date('2026-01-06T09:00:00Z'), // midweek W02 UTC
      });
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entryChangelog]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.summary.totalIssues).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // roadmapStatus 3-way enum (AC1–AC3)
  // -------------------------------------------------------------------------

  describe('roadmapStatus', () => {
    function setupRoadmapScenario(overrides: {
      issueStatus?: string;
      epicKey?: string | null;
      directLink?: boolean;
      completedAt?: Date | null;
      targetDate?: Date;
    }) {
      const {
        issueStatus = 'Done',
        epicKey = 'EPIC-1',
        directLink = false,
        completedAt = new Date('2026-01-08T10:00:00Z'),
        targetDate = new Date('2026-06-30T00:00:00Z'),
      } = overrides;

      boardConfigRepo.findOne.mockResolvedValue(
        kanbanConfig({
          cancelledStatusNames: ['Cancelled', "Won't Do"],
          roadmapLinkTypes: directLink ? ['is connected to'] : [],
        }),
      );

      const changelogs: JiraChangelog[] = [
        makeChangelog({
          issueKey: 'PLAT-1',
          fromValue: 'Backlog',
          toValue: 'To Do',
          changedAt: new Date('2026-01-06T09:00:00Z'),
        }),
      ];
      if (completedAt) {
        changelogs.push(
          makeChangelog({
            issueKey: 'PLAT-1',
            field: 'status',
            fromValue: 'In Progress',
            toValue: 'Done',
            changedAt: completedAt,
          }),
        );
      }

      issueRepo.find.mockResolvedValue([
        makeIssue({
          key: 'PLAT-1',
          epicKey: epicKey ?? null,
          status: issueStatus,
          createdAt: new Date('2025-12-01T00:00:00Z'),
        }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(changelogs),
      });

      roadmapConfigRepo.find.mockResolvedValue([
        { id: 1, jpdKey: 'JPD-1', description: null, startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() } as RoadmapConfig,
      ]);

      const ideaKey = directLink ? 'PT-1' : 'IDEA-1';
      jpdIdeaRepo.find.mockResolvedValue([
        {
          key: ideaKey,
          jpdKey: 'JPD-1',
          deliveryIssueKeys: epicKey ? [epicKey] : [],
          targetDate,
        } as unknown as JpdIdea,
      ]);

      if (directLink) {
        issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([
            { sourceIssueKey: 'PLAT-1', targetIssueKey: ideaKey, linkTypeName: 'is connected to' },
          ]),
        });
      } else {
        issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
        });
      }
    }

    it('returns roadmapStatus=in-scope when issue completed on or before targetDate (via epic)', async () => {
      setupRoadmapScenario({
        completedAt: new Date('2026-01-08T10:00:00Z'), // well before targetDate 2026-06-30
        targetDate: new Date('2026-06-30T00:00:00Z'),
      });
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).toBe('in-scope');
      expect(result.issues[0].roadmapLinkSource).toBe('epic');
    });

    it('returns roadmapStatus=linked when issue linked but not completed on time', async () => {
      setupRoadmapScenario({
        issueStatus: 'In Progress',
        completedAt: null,
        targetDate: new Date('2026-01-01T00:00:00Z'), // targetDate already passed
      });
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).toBe('linked');
    });

    it('returns roadmapStatus=none when issue has no roadmap link', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      const boardEntryCl = makeChangelog({ issueKey: 'PLAT-1', changedAt: new Date('2026-01-06T09:00:00Z') });
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', epicKey: null, createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([boardEntryCl]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).toBe('none');
      expect(result.issues[0].roadmapLinkSource).toBeNull();
    });

    it('returns roadmapStatus=none for cancelled issues even when linked to roadmap', async () => {
      setupRoadmapScenario({ issueStatus: 'Cancelled', completedAt: null });
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).toBe('none');
    });

    it('returns roadmapStatus=linked when idea has null targetDate', async () => {
      setupRoadmapScenario({ completedAt: null, targetDate: null as unknown as Date });
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).toBe('linked');
      expect(result.issues[0].roadmapLinkSource).toBe('epic');
    });

    it('returns roadmapStatus=in-scope (Condition B) for in-flight issue on active week with future targetDate', async () => {
      // Mirrors sprint Condition B: in-progress + active week + target not passed → green
      const now = new Date();
      // Build the ISO week key for the current week (YYYY-Www)
      const jan4 = new Date(Date.UTC(now.getUTCFullYear(), 0, 4));
      const jan4Day = jan4.getUTCDay();
      const daysToMon = jan4Day === 0 ? -6 : 1 - jan4Day;
      const mondayW1 = new Date(jan4);
      mondayW1.setUTCDate(jan4.getUTCDate() + daysToMon);
      const daysSinceMondayW1 = Math.floor((now.getTime() - mondayW1.getTime()) / (7 * 86400000));
      const currentWeekNum = daysSinceMondayW1 + 1;
      const currentWeekKey = `${now.getUTCFullYear()}-W${String(currentWeekNum).padStart(2, '0')}`;
      // Current week start (Monday)
      const currentWeekStart = new Date(mondayW1);
      currentWeekStart.setUTCDate(mondayW1.getUTCDate() + (currentWeekNum - 1) * 7);

      boardConfigRepo.findOne.mockResolvedValue(
        kanbanConfig({ cancelledStatusNames: ['Cancelled', "Won't Do"], roadmapLinkTypes: [] }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', epicKey: 'EPIC-1', status: 'In Progress', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        // Board entry changelog — transition into the current week
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', fromValue: 'Backlog', toValue: 'To Do', changedAt: currentWeekStart }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress', changedAt: currentWeekStart }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([
        { id: 1, jpdKey: 'JPD-1', description: null, startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() } as RoadmapConfig,
      ]);
      // Target is 60 days in the future — well beyond today
      const futureTarget = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      jpdIdeaRepo.find.mockResolvedValue([
        { key: 'IDEA-1', jpdKey: 'JPD-1', deliveryIssueKeys: ['EPIC-1'], targetDate: futureTarget } as unknown as JpdIdea,
      ]);
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getDetail('PLAT', currentWeekKey);
      expect(result.issues[0].roadmapStatus).toBe('in-scope');
    });

    it('returns roadmapStatus=linked for in-flight issue when targetDate already passed', async () => {
      setupRoadmapScenario({
        issueStatus: 'In Progress',
        completedAt: null,
        targetDate: new Date('2026-01-01T00:00:00Z'), // past target — Condition B does not apply
      });
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapStatus).toBe('linked');
    });

    it('gives epic link priority over direct link (AC3 — epic wins)', async () => {
      // Issue has both an epicKey covered by an idea AND a direct link to a different idea.
      // Epic should win: roadmapLinkSource = 'epic'.
      boardConfigRepo.findOne.mockResolvedValue(
        kanbanConfig({ cancelledStatusNames: ['Cancelled'], roadmapLinkTypes: ['is connected to'] }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', epicKey: 'EPIC-1', status: 'Done', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-06T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-08T10:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([
        { id: 1, jpdKey: 'JPD-1', description: null, startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() } as RoadmapConfig,
      ]);
      jpdIdeaRepo.find.mockResolvedValue([
        { key: 'PT-1', jpdKey: 'JPD-1', deliveryIssueKeys: ['EPIC-1'], targetDate: new Date('2026-06-30T00:00:00Z') } as unknown as JpdIdea,
      ]);
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { sourceIssueKey: 'PLAT-1', targetIssueKey: 'PT-1', linkTypeName: 'is connected to' },
        ]),
      });
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].roadmapLinkSource).toBe('epic');
    });

    it('summary.roadmapLinkedCount counts issues with roadmapStatus != none', async () => {
      setupRoadmapScenario({ completedAt: new Date('2026-01-08T10:00:00Z') });
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.roadmapLinkedCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // cycleTimeDays per issue and medianCycleTimeDays in summary (AC5–AC6)
  // -------------------------------------------------------------------------

  describe('cycleTimeDays', () => {
    it('computes cycleTimeDays as working days from first inProgress to first done transition', async () => {
      boardConfigRepo.findOne.mockResolvedValue(
        kanbanConfig({ inProgressStatusNames: ['In Progress'] }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'Done', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      // workingDaysBetween mock returns simple day diff
      const inProgressAt = new Date('2026-01-06T09:00:00Z');
      const doneAt = new Date('2026-01-08T09:00:00Z'); // 2 days later
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress', changedAt: inProgressAt }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: doneAt }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].cycleTimeDays).toBeCloseTo(2, 1);
    });

    it('returns cycleTimeDays=null when no inProgress transition exists', async () => {
      boardConfigRepo.findOne.mockResolvedValue(
        kanbanConfig({ inProgressStatusNames: ['In Progress'] }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'Done', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'Done', changedAt: new Date('2026-01-08T09:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.issues[0].cycleTimeDays).toBeNull();
    });

    it('computes medianCycleTimeDays as median of non-null cycleTimeDays values', async () => {
      boardConfigRepo.findOne.mockResolvedValue(
        kanbanConfig({ inProgressStatusNames: ['In Progress'] }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'Done', createdAt: new Date('2025-12-01T00:00:00Z') }),
        makeIssue({ key: 'PLAT-2', status: 'Done', createdAt: new Date('2025-12-01T00:00:00Z') }),
        makeIssue({ key: 'PLAT-3', status: 'Done', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      // workingDaysBetween returns day diff: PLAT-1=2d, PLAT-2=4d, PLAT-3=no inProgress→null
      // median of [2, 4] = 3
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress', changedAt: new Date('2026-01-06T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-08T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-2', fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-2', field: 'status', fromValue: 'To Do', toValue: 'In Progress', changedAt: new Date('2026-01-05T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-2', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-09T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-3', fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-3', field: 'status', fromValue: 'To Do', toValue: 'Done', changedAt: new Date('2026-01-08T09:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.medianCycleTimeDays).toBeCloseTo(3, 1);
    });

    it('returns medianCycleTimeDays=null when no issues have cycleTimeDays', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig({ inProgressStatusNames: ['In Progress'] }));
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'In Progress', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', fromValue: 'Backlog', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.medianCycleTimeDays).toBeNull();
    });

    it('surfaces isReopen=true when latest cycle follows a Done→In Progress reset (proposal 0054 AC4)', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig({ inProgressStatusNames: ['In Progress'] }));
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'Done', createdAt: new Date('2026-01-05T09:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress', changedAt: new Date('2026-01-05T10:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-06T17:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'Done', toValue: 'In Progress', changedAt: new Date('2026-01-07T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-08T17:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.issues[0].isReopen).toBe(true);
      expect(result.issues[0].cycleTimeDays).not.toBeNull();
      expect(result.summary.reopenedIssueCount).toBe(1);
    });

    it('returns isReopen=false on a single non-reopened cycle', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig({ inProgressStatusNames: ['In Progress'] }));
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'Done', createdAt: new Date('2026-01-05T09:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress', changedAt: new Date('2026-01-05T10:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-08T17:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);

      expect(result.issues[0].isReopen).toBe(false);
      expect(result.summary.reopenedIssueCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // incidentCount and failureCount in summary (AC4)
  // -------------------------------------------------------------------------

  describe('summary incident and failure counts', () => {
    it('incidentCount reflects number of incident issues in the week', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig({ incidentPriorities: [] }));
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', issueType: 'Bug', createdAt: new Date('2025-12-01T00:00:00Z') }),
        makeIssue({ key: 'PLAT-2', issueType: 'Story', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', changedAt: new Date('2026-01-06T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-2', changedAt: new Date('2026-01-06T09:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.incidentCount).toBe(1);
    });

    it('failureCount reflects number of failure issues in the week', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', labels: ['regression'], createdAt: new Date('2025-12-01T00:00:00Z') }),
        makeIssue({ key: 'PLAT-2', issueType: 'Story', createdAt: new Date('2025-12-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', changedAt: new Date('2026-01-06T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-2', changedAt: new Date('2026-01-06T09:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);
      const result = await service.getDetail('PLAT', WEEK);
      expect(result.summary.failureCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Proposal 0066 — board-wide completedIssues and expanded item list
  // -------------------------------------------------------------------------

  describe('proposal 0066 — board-wide completedIssues', () => {
    // WEEK = 2026-W02, WEEK_START = 2026-01-05 (Mon)

    it('completedIssues counts issues that completed this week from prior weeks', async () => {
      // PLAT-1 entered this week, PLAT-2 entered a prior week but completes this week
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'To Do' }),
        makeIssue({ key: 'PLAT-2', status: 'Done', createdAt: new Date('2025-11-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          // PLAT-1 enters this week
          makeChangelog({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
          // PLAT-2 entered 3 months ago
          makeChangelog({ issueKey: 'PLAT-2', toValue: 'To Do', changedAt: new Date('2025-11-01T09:00:00Z') }),
          // PLAT-2 completes this week
          makeChangelog({ issueKey: 'PLAT-2', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-07T14:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);

      // totalIssues = 1 (only PLAT-1 entered this week)
      expect(result.summary.totalIssues).toBe(1);
      // completedIssues = 1 (PLAT-2 completed this week from prior entry)
      expect(result.summary.completedIssues).toBe(1);
    });

    it('completed-from-prior-week issue appears in the issue list with completedInWeek=true', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', status: 'To Do' }),
        makeIssue({ key: 'PLAT-2', status: 'Done', createdAt: new Date('2025-11-01T00:00:00Z') }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          makeChangelog({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2026-01-05T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-2', toValue: 'To Do', changedAt: new Date('2025-11-01T09:00:00Z') }),
          makeChangelog({ issueKey: 'PLAT-2', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-07T14:00:00Z') }),
        ]),
      });
      roadmapConfigRepo.find.mockResolvedValue([]);

      const result = await service.getDetail('PLAT', WEEK);

      const keys = result.issues.map((i) => i.key);
      expect(keys).toContain('PLAT-1');
      expect(keys).toContain('PLAT-2');
      const plat2 = result.issues.find((i) => i.key === 'PLAT-2')!;
      expect(plat2.completedInWeek).toBe(true);
      expect(plat2.addedMidWeek).toBe(false);
    });

     it('completedIssues excludes issues where inBacklog=true', async () => {
       boardConfigRepo.findOne.mockResolvedValue(kanbanConfig());
       issueRepo.find.mockResolvedValue([
         makeIssue({ key: 'PLAT-1', status: 'Done' }),
         { ...makeIssue({ key: 'PLAT-2', status: 'Done' }), inBacklog: true }, // in backlog
       ] as unknown as JiraIssue[]);
       changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
         where: jest.fn().mockReturnThis(),
         andWhere: jest.fn().mockReturnThis(),
         orderBy: jest.fn().mockReturnThis(),
         getMany: jest.fn().mockResolvedValue([
           makeChangelog({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2025-11-01T09:00:00Z') }),
           makeChangelog({ issueKey: 'PLAT-2', toValue: 'To Do', changedAt: new Date('2025-11-01T09:00:00Z') }),
           makeChangelog({ issueKey: 'PLAT-1', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-07T14:00:00Z') }),
           makeChangelog({ issueKey: 'PLAT-2', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-01-07T14:00:00Z') }),
         ]),
       });
       roadmapConfigRepo.find.mockResolvedValue([]);

       const result = await service.getDetail('PLAT', WEEK);

       // PLAT-2 has inBacklog=true — must not be counted
       expect(result.summary.completedIssues).toBe(1);
     });

    it('scrum boards are unaffected (week detail only serves kanban — reject test)', async () => {
      boardConfigRepo.findOne.mockResolvedValue({ ...kanbanConfig(), boardType: 'scrum' } as unknown as BoardConfig);
      issueRepo.find.mockResolvedValue([makeIssue()]);
      roadmapConfigRepo.find.mockResolvedValue([]);
      await expect(service.getDetail('PLAT', WEEK)).rejects.toThrow();
    });
  });
});

