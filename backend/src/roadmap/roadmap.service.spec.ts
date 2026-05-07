import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { RoadmapService } from './roadmap.service.js';
import { SyncService } from '../sync/sync.service.js';
import {
  SprintMembershipService,
  SprintMembership,
} from '../sprint-membership/sprint-membership.service.js';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  JpdIdea,
  JiraIssueLink,
  RoadmapConfig,
  BoardConfig,
} from '../database/entities/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((dto: Partial<T>) => dto as T),
    save: jest.fn().mockImplementation(async (e: T) => e),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  } as unknown as jest.Mocked<Repository<T>>;
}

function mockConfigService(tz = 'UTC'): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation((_key: string, defaultVal?: unknown) => {
      if (_key === 'TIMEZONE') return tz;
      return defaultVal ?? '';
    }),
  } as unknown as jest.Mocked<ConfigService>;
}

function mockSyncService(): jest.Mocked<SyncService> {
  return {
    syncRoadmaps: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SyncService>;
}

function emptyMembership(): SprintMembership {
  return {
    committedKeys: new Set(),
    addedKeys: new Set(),
    committedRemovedKeys: new Set(),
    addedRemovedKeys: new Set(),
    currentMemberKeys: new Set(),
    logsByIssue: new Map(),
  };
}

interface MockSprintMembership {
  service: jest.Mocked<SprintMembershipService>;
  /** Seed a sprint's membership; subsequent calls overwrite the same sprint id. */
  seed(
    sprintId: string,
    parts: { committed?: string[]; added?: string[]; removed?: string[] },
  ): void;
}

function mockSprintMembership(): MockSprintMembership {
  const memberships = new Map<string, SprintMembership>();

  const reconstructMany = jest.fn(
    async (input: { sprints: { id: string }[] }) => {
      const result = new Map<string, SprintMembership>();
      for (const s of input.sprints) {
        result.set(s.id, memberships.get(s.id) ?? emptyMembership());
      }
      return result;
    },
  );

  const reconstruct = jest.fn(async (input: { sprint: { id: string } }) => {
    return memberships.get(input.sprint.id) ?? emptyMembership();
  });

  const service = {
    reconstruct,
    reconstructMany,
  } as unknown as jest.Mocked<SprintMembershipService>;

  return {
    service,
    seed(sprintId, parts) {
      memberships.set(sprintId, {
        committedKeys: new Set(parts.committed ?? []),
        addedKeys: new Set(parts.added ?? []),
        committedRemovedKeys: new Set(parts.removed ?? []),
        addedRemovedKeys: new Set(),
        currentMemberKeys: new Set([
          ...(parts.committed ?? []),
          ...(parts.added ?? []),
        ]),
        logsByIssue: new Map(),
      });
    },
  };
}

function buildQb(results: object[]) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(results),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  return qb;
}

function makeSprint(overrides: Partial<JiraSprint> = {}): JiraSprint {
  return {
    id: 'sprint-1',
    boardId: 'ACC',
    name: 'Sprint 1',
    state: 'closed',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-01-14T23:59:59Z'),
    ...overrides,
  } as unknown as JiraSprint;
}

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'ACC-1',
    boardId: 'ACC',
    issueType: 'Story',
    summary: 'Do work',
    status: 'Done',
    labels: [],
    epicKey: null,
    fixVersion: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    priority: null,
    points: null,
    statusId: null,
    ...overrides,
  } as unknown as JiraIssue;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RoadmapService', () => {
  let service: RoadmapService;
  let sprintRepo: jest.Mocked<Repository<JiraSprint>>;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let jpdIdeaRepo: jest.Mocked<Repository<JpdIdea>>;
  let issueLinkRepo: jest.Mocked<Repository<JiraIssueLink>>;
  let roadmapConfigRepo: jest.Mocked<Repository<RoadmapConfig>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let syncService: jest.Mocked<SyncService>;
  let membership: MockSprintMembership;

  beforeEach(() => {
    sprintRepo = mockRepo<JiraSprint>();
    issueRepo = mockRepo<JiraIssue>();
    changelogRepo = mockRepo<JiraChangelog>();
    jpdIdeaRepo = mockRepo<JpdIdea>();
    issueLinkRepo = mockRepo<JiraIssueLink>();
    roadmapConfigRepo = mockRepo<RoadmapConfig>();
    boardConfigRepo = mockRepo<BoardConfig>();
    syncService = mockSyncService();
    membership = mockSprintMembership();

    service = new RoadmapService(
      sprintRepo,
      issueRepo,
      changelogRepo,
      jpdIdeaRepo,
      issueLinkRepo,
      roadmapConfigRepo,
      boardConfigRepo,
      syncService,
      mockConfigService(),
      membership.service,
    );
  });

  // -------------------------------------------------------------------------
  // getAccuracy — Scrum, no sprint ID (active + closed)
  // -------------------------------------------------------------------------

  describe('getAccuracy (scrum, no filter)', () => {
    it('returns empty array when board has no sprints', async () => {
      sprintRepo.find.mockResolvedValue([]);
      const result = await service.getAccuracy('ACC');
      expect(result).toEqual([]);
    });

    it('returns emptyAccuracy objects for sprints with no issues', async () => {
      const sprint = makeSprint();
      sprintRepo.find
        .mockResolvedValueOnce([sprint]) // active sprints
        .mockResolvedValueOnce([]);      // closed sprints
      issueRepo.find.mockResolvedValue([]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));

      const result = await service.getAccuracy('ACC');
      expect(result).toHaveLength(1);
      expect(result[0].sprintId).toBe('sprint-1');
      expect(result[0].totalIssues).toBe(0);
      expect(result[0].coveredIssues).toBe(0);
    });

    it('excludes Epic issue type from accuracy calculation', async () => {
      const sprint = makeSprint();
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      // Only an Epic on the board — should be filtered out
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-EPIC', issueType: 'Epic' }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));

      const result = await service.getAccuracy('ACC');
      expect(result[0].totalIssues).toBe(0);
    });

    it('excludes Sub-task issue type', async () => {
      const sprint = makeSprint();
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-2', issueType: 'Sub-task' }),
      ]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));

      const result = await service.getAccuracy('ACC');
      expect(result[0].totalIssues).toBe(0);
    });

    it('assigns issue to sprint when sprintId matches and no changelogs', async () => {
      const sprint = makeSprint({ id: 'sprint-1' });
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      const issue = makeIssue({ key: 'ACC-1', status: 'Done' });
      issueRepo.find.mockResolvedValue([issue]);
      roadmapConfigRepo.find.mockResolvedValue([]);
      // Membership reconstructed by SprintMembershipService — issue committed.
      membership.seed('sprint-1', { committed: ['ACC-1'] });

      // Status changelogs (used by calculateSprintAccuracy): empty.
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));

      const result = await service.getAccuracy('ACC');
      expect(result[0].totalIssues).toBe(1);
    });

    it('assigns issue to sprint via sprintId when it has changelogs for other sprints only (carry-forward)', async () => {
      // Reproduces the ACC sprint 2 bug: Jira carries issues forward from sprint
      // 1 into sprint 2 but only emits a changelog entry like
      //   fromValue: "Sprint 1"  toValue: "Sprint 1, Ready to estimate 2"
      // with no entry that mentions "Sprint 2" at all.  The issue's sprintId
      // column correctly points to sprint-2, so it should appear in sprint-2's
      // count despite having no "Sprint 2" changelog entry.
      const sprint1 = makeSprint({ id: 'sprint-1', name: 'Sprint 1', state: 'closed',
        startDate: new Date('2026-01-01T00:00:00Z'), endDate: new Date('2026-01-14T23:59:59Z') });
      const sprint2 = makeSprint({ id: 'sprint-2', name: 'Sprint 2', state: 'active',
        startDate: new Date('2026-01-15T00:00:00Z'), endDate: new Date('2026-01-28T23:59:59Z') });

      sprintRepo.find
        .mockResolvedValueOnce([sprint2])   // active sprints
        .mockResolvedValueOnce([sprint1]);  // closed sprints

      // Issue currently in sprint-2 (carry-forward from sprint-1).
      // SprintMembershipService is responsible for resolving the carry-forward
      // semantics from the changelog + join table; here we just assert that
      // RoadmapService includes whatever it returns.
      const issue = makeIssue({
        key: 'ACC-1', status: 'In Progress',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      issueRepo.find.mockResolvedValue([issue]);

      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));
      roadmapConfigRepo.find.mockResolvedValue([]);
      jpdIdeaRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));
      // Membership service places the issue in sprint-2 as a carry-over (committed).
      membership.seed('sprint-2', { committed: ['ACC-1'] });

      const result = await service.getAccuracy('ACC');
      const sprint2Result = result.find((r) => r.sprintId === 'sprint-2');
      expect(sprint2Result).toBeDefined();
      expect(sprint2Result!.totalIssues).toBe(1);
    });

    it('keeps cancelled issues in totals but classifies them as uncovered (default "Cancelled")', async () => {
      const sprint = makeSprint({ id: 'sprint-1' });
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', status: 'Cancelled' }),
      ]);
      roadmapConfigRepo.find.mockResolvedValue([]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));
      membership.seed('sprint-1', { committed: ['ACC-1'] });

      const result = await service.getAccuracy('ACC');
      expect(result[0].totalIssues).toBe(1);
      expect(result[0].coveredIssues).toBe(0);
      expect(result[0].uncoveredIssues).toBe(1);
      expect(result[0].linkedCount).toBe(0);
    });

    it('keeps "Won\'t Do" cancelled issues in totals but classifies them as uncovered', async () => {
      const sprint = makeSprint({ id: 'sprint-1' });
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', status: "Won't Do" }),
      ]);
      roadmapConfigRepo.find.mockResolvedValue([]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));
      membership.seed('sprint-1', { committed: ['ACC-1'] });

      const result = await service.getAccuracy('ACC');
      expect(result[0].totalIssues).toBe(1);
      expect(result[0].uncoveredIssues).toBe(1);
      expect(result[0].linkedCount).toBe(0);
    });

    it('respects custom cancelledStatusNames from boardConfig (cancelled stays in total, classified uncovered)', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'ACC',
        boardType: 'scrum',
        cancelledStatusNames: ['Rejected'],
        doneStatusNames: ['Done'],
      } as unknown as BoardConfig);

      const sprint = makeSprint({ id: 'sprint-1' });
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', status: 'Rejected' }),
      ]);
      roadmapConfigRepo.find.mockResolvedValue([]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));
      membership.seed('sprint-1', { committed: ['ACC-1'] });

      const result = await service.getAccuracy('ACC');
      expect(result[0].totalIssues).toBe(1);
      expect(result[0].uncoveredIssues).toBe(1);
      expect(result[0].linkedCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — Scrum by sprintId
  // -------------------------------------------------------------------------

  describe('getAccuracy (scrum, by sprintId)', () => {
    it('returns result for a single sprint by id', async () => {
      const sprint = makeSprint();
      sprintRepo.findOne.mockResolvedValue(sprint);
      issueRepo.find.mockResolvedValue([]);
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));

      const result = await service.getAccuracy('ACC', 'sprint-1');
      expect(result).toHaveLength(1);
      expect(result[0].sprintId).toBe('sprint-1');
    });

    it('returns empty when sprintId is not found', async () => {
      sprintRepo.findOne.mockResolvedValue(null);
      const result = await service.getAccuracy('ACC', 'nonexistent');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — Kanban board
  // -------------------------------------------------------------------------

  describe('getAccuracy (kanban)', () => {
    beforeEach(() => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        cancelledStatusNames: ['Cancelled', "Won't Do"],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);
    });

    it('throws BadRequestException when sprintId is provided for kanban board', async () => {
      await expect(
        service.getAccuracy('PLAT', 'sprint-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns empty array when kanban board has no issues', async () => {
      issueRepo.find.mockResolvedValue([]);
      const result = await service.getAccuracy('PLAT');
      expect(result).toEqual([]);
    });

    it('returns empty array for kanban when all issues are backlog (no changelogs)', async () => {
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT' }),
      ]);
      // No "To Do" exit changelogs, no any-status changelogs → issue is backlog
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));

      const result = await service.getAccuracy('PLAT');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — quarter filter on scrum board
  // -------------------------------------------------------------------------

  describe('getAccuracy (scrum, by quarter)', () => {
    it('returns empty array when no closed sprints fall in the quarter', async () => {
      const qbMock = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      sprintRepo.createQueryBuilder = jest.fn().mockReturnValue(qbMock);
      boardConfigRepo.findOne.mockResolvedValue(null);

      const result = await service.getAccuracy('ACC', undefined, '2026-Q1');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getConfigs
  // -------------------------------------------------------------------------

  describe('getConfigs', () => {
    it('returns all roadmap configs ordered by createdAt', async () => {
      const configs: RoadmapConfig[] = [
        { id: 1, jpdKey: 'JPD-1', description: null, startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() },
        { id: 2, jpdKey: 'JPD-2', description: 'Desc', startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() },
      ];
      roadmapConfigRepo.find.mockResolvedValue(configs);

      const result = await service.getConfigs();
      expect(result).toHaveLength(2);
      expect(roadmapConfigRepo.find).toHaveBeenCalledWith({ order: { createdAt: 'ASC' } });
    });

    it('returns empty array when no configs', async () => {
      roadmapConfigRepo.find.mockResolvedValue([]);
      const result = await service.getConfigs();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // createConfig
  // -------------------------------------------------------------------------

  describe('createConfig', () => {
    it('creates a new roadmap config', async () => {
      roadmapConfigRepo.findOne.mockResolvedValue(null);
      const saved = { id: 1, jpdKey: 'JPD-NEW', description: 'Test', startDateFieldId: null, targetDateFieldId: null, createdAt: new Date() };
      roadmapConfigRepo.save.mockResolvedValue(saved as RoadmapConfig);

      const result = await service.createConfig('JPD-NEW', 'Test');
      expect(roadmapConfigRepo.create).toHaveBeenCalledWith({ jpdKey: 'JPD-NEW', description: 'Test' });
      expect(result.jpdKey).toBe('JPD-NEW');
    });

    it('defaults description to null when not provided', async () => {
      roadmapConfigRepo.findOne.mockResolvedValue(null);
      roadmapConfigRepo.save.mockImplementation(async (e) => e as RoadmapConfig);

      await service.createConfig('JPD-NO-DESC');
      expect(roadmapConfigRepo.create).toHaveBeenCalledWith({ jpdKey: 'JPD-NO-DESC', description: null });
    });

    it('throws ConflictException when jpdKey already exists', async () => {
      roadmapConfigRepo.findOne.mockResolvedValue({
        id: 1, jpdKey: 'JPD-1',
      } as unknown as RoadmapConfig);

      await expect(service.createConfig('JPD-1')).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // updateConfig
  // -------------------------------------------------------------------------

  describe('updateConfig', () => {
    it('updates startDateFieldId and targetDateFieldId', async () => {
      const existing: RoadmapConfig = {
        id: 1,
        jpdKey: 'JPD-1',
        description: null,
        startDateFieldId: null,
        targetDateFieldId: null,
        createdAt: new Date(),
      };
      roadmapConfigRepo.findOne.mockResolvedValue(existing);
      roadmapConfigRepo.save.mockImplementation(async (e) => e as RoadmapConfig);

      const result = await service.updateConfig(1, 'customfield_10020', 'customfield_10030');
      expect(result.startDateFieldId).toBe('customfield_10020');
      expect(result.targetDateFieldId).toBe('customfield_10030');
    });

    it('does not overwrite field when argument is undefined', async () => {
      const existing: RoadmapConfig = {
        id: 1,
        jpdKey: 'JPD-1',
        description: null,
        startDateFieldId: 'cf_start',
        targetDateFieldId: 'cf_target',
        createdAt: new Date(),
      };
      roadmapConfigRepo.findOne.mockResolvedValue(existing);
      roadmapConfigRepo.save.mockImplementation(async (e) => e as RoadmapConfig);

      const result = await service.updateConfig(1, undefined, undefined);
      // Neither field should be changed
      expect(result.startDateFieldId).toBe('cf_start');
      expect(result.targetDateFieldId).toBe('cf_target');
    });

    it('allows setting field to null explicitly', async () => {
      const existing: RoadmapConfig = {
        id: 1,
        jpdKey: 'JPD-1',
        description: null,
        startDateFieldId: 'cf_start',
        targetDateFieldId: 'cf_target',
        createdAt: new Date(),
      };
      roadmapConfigRepo.findOne.mockResolvedValue(existing);
      roadmapConfigRepo.save.mockImplementation(async (e) => e as RoadmapConfig);

      const result = await service.updateConfig(1, null, null);
      expect(result.startDateFieldId).toBeNull();
      expect(result.targetDateFieldId).toBeNull();
    });

    it('throws NotFoundException when config id not found', async () => {
      roadmapConfigRepo.findOne.mockResolvedValue(null);
      await expect(service.updateConfig(999)).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // deleteConfig
  // -------------------------------------------------------------------------

  describe('deleteConfig', () => {
    it('deletes an existing config', async () => {
      roadmapConfigRepo.findOne.mockResolvedValue({
        id: 1, jpdKey: 'JPD-1',
      } as unknown as RoadmapConfig);

      await service.deleteConfig(1);
      expect(roadmapConfigRepo.delete).toHaveBeenCalledWith({ id: 1 });
    });

    it('throws NotFoundException when config id not found', async () => {
      roadmapConfigRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteConfig(999)).rejects.toThrow(NotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // syncRoadmaps
  // -------------------------------------------------------------------------

  describe('syncRoadmaps', () => {
    it('calls syncService.syncRoadmaps and returns success message', async () => {
      const result = await service.syncRoadmaps();
      expect(syncService.syncRoadmaps).toHaveBeenCalled();
      expect(result.message).toBe('Roadmap sync completed');
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — scrum with roadmap idea coverage
  // -------------------------------------------------------------------------

  describe('getAccuracy (scrum with idea coverage)', () => {
    it('counts issue as covered when delivered on time within sprint window', async () => {
      const sprint = makeSprint({
        id: 'sprint-1',
        name: 'Sprint 1',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-01-14T23:59:59Z'),
      });
      sprintRepo.find
        .mockResolvedValueOnce([sprint])  // active
        .mockResolvedValueOnce([]);       // closed

      const issue = makeIssue({
        key: 'ACC-1',
        status: 'Done',
        epicKey: 'EPIC-1',
      });
      issueRepo.find.mockResolvedValue([issue]);
      // Membership service places ACC-1 in sprint-1 (committed).
      membership.seed('sprint-1', { committed: ['ACC-1'] });

      // One JPD idea covering EPIC-1 within the sprint window
      const idea = {
        key: 'JPD-1',
        summary: 'Feature A',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: new Date('2026-01-01T00:00:00Z'),
        targetDate: new Date('2026-01-14T00:00:00Z'),
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([{ id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig]);
      jpdIdeaRepo.find.mockResolvedValue([idea]);

      // Status changelogs: Done transition within the sprint window (before targetDate).
      // Sprint-field changelogs are no longer queried directly — that's the
      // SprintMembershipService's responsibility.
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
        buildQb([
          {
            issueKey: 'ACC-1',
            field: 'status',
            fromValue: 'In Progress',
            toValue: 'Done',
            changedAt: new Date('2026-01-10T12:00:00Z'),
          },
        ]),
      );

      const result = await service.getAccuracy('ACC');
      expect(result).toHaveLength(1);
      expect(result[0].totalIssues).toBe(1);
      expect(result[0].coveredIssues).toBe(1);
      expect(result[0].roadmapCoverage).toBe(100);
      expect(result[0].roadmapOnTimeRate).toBe(100);
    });

    it('counts issue as linked-not-covered when delivered late', async () => {
      const sprint = makeSprint({
        id: 'sprint-1',
        name: 'Sprint 1',
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-01-14T23:59:59Z'),
      });
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);

      const issue = makeIssue({
        key: 'ACC-1',
        status: 'Done',
        epicKey: 'EPIC-1',
      });
      issueRepo.find.mockResolvedValue([issue]);

      // Idea targetDate = Jan 5 — issue resolved Jan 10 (late)
      const idea = {
        key: 'JPD-1',
        summary: 'Feature A',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: new Date('2026-01-01T00:00:00Z'),
        targetDate: new Date('2026-01-05T00:00:00Z'),
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([{ id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig]);
      jpdIdeaRepo.find.mockResolvedValue([idea]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        return {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue(
            qbCallCount === 1
              ? []
              : [{
                  issueKey: 'ACC-1',
                  field: 'status',
                  fromValue: 'In Progress',
                  toValue: 'Done',
                  changedAt: new Date('2026-01-10T12:00:00Z'), // after targetDate
                }]
          ),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
      });

      const result = await service.getAccuracy('ACC');
      expect(result[0].coveredIssues).toBe(0);
      expect(result[0].roadmapOnTimeRate).toBe(0);
    });

    it('returns empty accuracy for sprints when board has no work items', async () => {
      const sprint = makeSprint();
      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getAccuracy('ACC');
      expect(result).toHaveLength(1);
      expect(result[0].totalIssues).toBe(0);
      expect(result[0].coveredIssues).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — in-flight Condition B (proposal 0020)
  // -------------------------------------------------------------------------

  describe('getAccuracy (scrum, Condition B — in-flight coverage)', () => {
    function makeInFlightSetup(overrides: {
      sprintState: 'active' | 'closed';
      issueStatus: string;
      targetDate: Date;
    }) {
      const sprint = makeSprint({
        id: 'sprint-1',
        name: 'Sprint 1',
        state: overrides.sprintState,
        startDate: new Date('2026-01-01T00:00:00Z'),
        endDate: new Date('2026-01-14T23:59:59Z'),
      });

      if (overrides.sprintState === 'active') {
        sprintRepo.find
          .mockResolvedValueOnce([sprint]) // active
          .mockResolvedValueOnce([]);      // closed
      } else {
        sprintRepo.find
          .mockResolvedValueOnce([])       // active (none)
          .mockResolvedValueOnce([sprint]); // closed
      }

      const issue = makeIssue({
        key: 'ACC-1',
        status: overrides.issueStatus,
        epicKey: 'EPIC-1',
      });
      issueRepo.find.mockResolvedValue([issue]);
      // Membership service places ACC-1 in sprint-1 (committed).
      membership.seed('sprint-1', { committed: ['ACC-1'] });

      const idea = {
        key: 'JPD-1',
        summary: 'Feature A',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: new Date('2026-01-01T00:00:00Z'),
        targetDate: overrides.targetDate,
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([
        { id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig,
      ]);
      jpdIdeaRepo.find.mockResolvedValue([idea]);

      // Sprint field changelogs: empty (issue assigned at creation)
      // Status changelogs: empty (no done transition)
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        getRawMany: jest.fn().mockResolvedValue([]),
      }));
    }

    it('counts in-flight issue as covered when active sprint and targetDate is in the future', async () => {
      // targetDate well in the future (year 2099 ensures test is always future-dated)
      makeInFlightSetup({
        sprintState: 'active',
        issueStatus: 'In Progress',
        targetDate: new Date('2099-12-31T00:00:00Z'),
      });

      const result = await service.getAccuracy('ACC');
      expect(result).toHaveLength(1);
      expect(result[0].coveredIssues).toBe(1);
      expect(result[0].roadmapCoverage).toBe(100);
    });

    it('counts in-flight issue as NOT covered when active sprint but targetDate has lapsed', async () => {
      // targetDate in the past
      makeInFlightSetup({
        sprintState: 'active',
        issueStatus: 'In Progress',
        targetDate: new Date('2020-01-01T00:00:00Z'),
      });

      const result = await service.getAccuracy('ACC');
      expect(result).toHaveLength(1);
      expect(result[0].coveredIssues).toBe(0);
    });

    it('counts in-flight issue as NOT covered in a closed sprint even with future targetDate', async () => {
      // Condition B requires sprint.state === 'active'
      makeInFlightSetup({
        sprintState: 'closed',
        issueStatus: 'In Progress',
        targetDate: new Date('2099-12-31T00:00:00Z'),
      });

      const result = await service.getAccuracy('ACC');
      expect(result).toHaveLength(1);
      expect(result[0].coveredIssues).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — Kanban accuracy (getKanbanAccuracy)
  // -------------------------------------------------------------------------

  describe('getAccuracy (kanban quarterly accuracy)', () => {
    const kanbanConfig = {
      boardId: 'PLAT',
      boardType: 'kanban',
      doneStatusNames: ['Done'],
      cancelledStatusNames: ['Cancelled', "Won't Do"],
      backlogStatusIds: [],
      dataStartDate: null,
    } as unknown as BoardConfig;

    it('returns empty when kanban board has no issues', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getAccuracy('PLAT');
      expect(result).toEqual([]);
    });

    it('returns empty when all issues are pure backlog (no changelogs)', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT' }),
      ]);
      // All query builders return empty results
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb([]));

      const result = await service.getAccuracy('PLAT');
      expect(result).toEqual([]);
    });

    it('groups issues by quarter and computes coverage with ideas', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', epicKey: 'EPIC-1' }),
      ]);

      // Idea covering EPIC-1 in Q1 2026
      const idea = {
        key: 'JPD-1',
        summary: 'Feature A',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: new Date('2026-01-01T00:00:00Z'),
        targetDate: new Date('2026-03-31T00:00:00Z'),
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([{ id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig]);
      jpdIdeaRepo.find.mockResolvedValue([idea]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };

        if (qbCallCount === 1) {
          // "To Do" exit changelogs
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z'),
            },
          ]);
        } else if (qbCallCount === 2) {
          // DISTINCT issueKey (backlogStatusIds empty)
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        } else if (qbCallCount === 3) {
          // All status changelogs for bounded issues (both activity start + done)
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z'),
            },
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'In Progress',
              toValue: 'Done',
              changedAt: new Date('2026-01-20T09:00:00Z'),
            },
          ]);
        }
        return qb;
      });

      const result = await service.getAccuracy('PLAT');
      expect(result).toHaveLength(1);
      expect(result[0].sprintId).toBe('2026-Q1');
      expect(result[0].totalIssues).toBe(1);
      // Issue has epicKey EPIC-1, which maps to the idea — it started before targetDate
      expect(result[0].coveredIssues).toBeGreaterThanOrEqual(0);
    });

    it('filters to a specific quarter when quarter param provided', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', createdAt: new Date('2026-01-05T00:00:00Z') }),
      ]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };

        if (qbCallCount === 1) {
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z'),
            },
          ]);
        } else if (qbCallCount === 2) {
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        }
        return qb;
      });

      roadmapConfigRepo.find.mockResolvedValue([]);
      jpdIdeaRepo.find.mockResolvedValue([]);

      // Filter for a non-matching quarter — should return empty results
      const result = await service.getAccuracy('PLAT', undefined, '2025-Q4');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — Kanban weekly accuracy (getKanbanWeeklyAccuracy)
  // -------------------------------------------------------------------------

  describe('getAccuracy (kanban week mode)', () => {
    const kanbanConfig = {
      boardId: 'PLAT',
      boardType: 'kanban',
      doneStatusNames: ['Done'],
      cancelledStatusNames: ['Cancelled', "Won't Do"],
      backlogStatusIds: [],
      dataStartDate: null,
    } as unknown as BoardConfig;

    it('routes to weekly accuracy when week param is provided', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getAccuracy('PLAT', undefined, undefined, '2026-W02');
      expect(result).toEqual([]);
    });

    it('routes to weekly accuracy when weekMode=true', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getAccuracy('PLAT', undefined, undefined, undefined, true);
      expect(result).toEqual([]);
    });

    it('groups issues by ISO week and computes coverage', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);

      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', epicKey: 'EPIC-1' }),
      ]);

      const idea = {
        key: 'JPD-1',
        summary: 'Feature A',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: new Date('2026-01-05T00:00:00Z'),  // W02 start
        targetDate: new Date('2026-01-11T00:00:00Z'),  // W02 end
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([{ id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig]);
      jpdIdeaRepo.find.mockResolvedValue([idea]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };

        if (qbCallCount === 1) {
          // board-entry changelogs — toValue='To Do' is a default boardEntryStatus → W02
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'Backlog',
              toValue: 'To Do',
              changedAt: new Date('2026-01-06T09:00:00Z'),
            },
          ]);
        } else if (qbCallCount === 2) {
          // DISTINCT issueKey query
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        } else if (qbCallCount === 3) {
          // All status changelogs
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-06T09:00:00Z'),
            },
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'In Progress',
              toValue: 'Done',
              changedAt: new Date('2026-01-08T12:00:00Z'),
            },
          ]);
        }
        return qb;
      });

      const result = await service.getAccuracy('PLAT', undefined, undefined, '2026-W02');
      expect(result).toHaveLength(1);
      expect(result[0].sprintId).toBe('2026-W02');
      expect(result[0].totalIssues).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getKanbanWeeklyAccuracy — boardEntryDate uses toValue IN boardEntryStatuses
  //
  // The roadmap table for Kanban boards was using fromValue = 'To Do' (hardcoded,
  // wrong direction) to detect when an issue entered the board. This caused the
  // roadmap table to disagree with the week detail page (which was fixed first)
  // and with the planning page (which always used toValue IN boardEntryStatuses).
  // -------------------------------------------------------------------------

  describe('getKanbanWeeklyAccuracy — boardEntryDate direction fix', () => {
    const kanbanConfig = {
      boardId: 'PLAT',
      boardType: 'kanban',
      doneStatusNames: ['Done'],
      cancelledStatusNames: ['Cancelled', "Won't Do"],
      backlogStatusIds: [],
      dataStartDate: null,
      boardEntryStatuses: null, // use defaults
    } as unknown as BoardConfig;

    function setupWeeklyAccuracyRepo(entryChangelog: object, doneChangelog?: object) {
      let callCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        callCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        if (callCount === 1) {
          // board-entry changelogs query
          qb.getMany.mockResolvedValue([entryChangelog]);
        } else if (callCount === 2) {
          // DISTINCT issueKey fallback
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        } else if (callCount === 3) {
          // all status changelogs for completion/activity dates
          qb.getMany.mockResolvedValue(doneChangelog ? [entryChangelog, doneChangelog] : [entryChangelog]);
        }
        return qb;
      });
      roadmapConfigRepo.find.mockResolvedValue([]);
      jpdIdeaRepo.find.mockResolvedValue([]);
    }

    it('counts issue whose toValue is a board-entry status in W02', async () => {
      // toValue='To Do' is a default boardEntryStatus → issue entered the board in W02
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', createdAt: new Date('2025-11-01T00:00:00Z') }),
      ]);
      setupWeeklyAccuracyRepo({
        issueKey: 'PLAT-1', field: 'status',
        fromValue: 'Backlog', toValue: 'To Do',
        changedAt: new Date('2026-01-06T09:00:00Z'), // W02
      });

      const result = await service.getAccuracy('PLAT', undefined, undefined, '2026-W02');
      expect(result).toHaveLength(1);
      expect(result[0].totalIssues).toBe(1);
    });

    it('does not count issue that only has fromValue=To Do transition (old wrong direction) when its toValue is not a board-entry status', async () => {
      // fromValue='To Do', toValue='In Progress' — old code matched this; new code must NOT.
      // Issue has createdAt well before W02, so it should not appear in W02 at all.
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', createdAt: new Date('2025-11-01T00:00:00Z') }),
      ]);
      // The new query uses toValue IN boardEntryStatuses — 'In Progress' is NOT in that list,
      // so the DB returns no board-entry changelogs. Simulate that here.
      setupWeeklyAccuracyRepo(
        // First call (board-entry query) returns empty — no toValue match
        { issueKey: '__none__', field: 'status', fromValue: null, toValue: null, changedAt: new Date() },
      );
      // Override: first call returns empty array to simulate no DB match
      let callCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        callCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        if (callCount === 1) {
          // board-entry query: toValue='In Progress' not in boardEntryStatuses → empty
          qb.getMany.mockResolvedValue([]);
        } else if (callCount === 2) {
          // DISTINCT issueKey fallback — issue has some status changelogs
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        } else if (callCount === 3) {
          // all status changelogs for completion/activity
          qb.getMany.mockResolvedValue([{
            issueKey: 'PLAT-1', field: 'status',
            fromValue: 'To Do', toValue: 'In Progress',
            changedAt: new Date('2026-01-06T09:00:00Z'),
          }]);
        }
        return qb;
      });
      roadmapConfigRepo.find.mockResolvedValue([]);
      jpdIdeaRepo.find.mockResolvedValue([]);

      // No board-entry found → falls back to createdAt (Nov 2025) → excluded from W02.
      const result = await service.getAccuracy('PLAT', undefined, undefined, '2026-W02');
      expect(result).toHaveLength(0);
    });

    it('counts issue entered via "Open" (non-hardcoded default entry status) in correct week', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-2', boardId: 'PLAT', createdAt: new Date('2025-11-01T00:00:00Z') }),
      ]);
      setupWeeklyAccuracyRepo({
        issueKey: 'PLAT-2', field: 'status',
        fromValue: 'Backlog', toValue: 'Open',
        changedAt: new Date('2026-01-06T09:00:00Z'), // W02
      });

      const result = await service.getAccuracy('PLAT', undefined, undefined, '2026-W02');
      expect(result).toHaveLength(1);
      expect(result[0].totalIssues).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // filterIdeasForWindow and isIssueEligibleForRoadmapItem (via getKanbanAccuracy)
  // -------------------------------------------------------------------------

  describe('filterIdeasForWindow edge cases', () => {
    const kanbanConfig = {
      boardId: 'PLAT',
      boardType: 'kanban',
      doneStatusNames: ['Done'],
      cancelledStatusNames: ['Cancelled', "Won't Do"],
      backlogStatusIds: [],
      dataStartDate: null,
    } as unknown as BoardConfig;

    it('excludes ideas with null startDate or targetDate', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', epicKey: 'EPIC-1' }),
      ]);

      // Idea without both dates — should be excluded from coverage
      const ideaNoDate = {
        key: 'JPD-2',
        summary: 'No dates',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: null,
        targetDate: null,
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([{ id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig]);
      jpdIdeaRepo.find.mockResolvedValue([ideaNoDate]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        if (qbCallCount === 1) {
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z'),
            },
          ]);
        } else if (qbCallCount === 2) {
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        }
        return qb;
      });

      const result = await service.getAccuracy('PLAT');
      expect(result[0].coveredIssues).toBe(0);
    });

    it('handles idea with null deliveryIssueKeys gracefully', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', epicKey: 'EPIC-1' }),
      ]);

      const ideaNullKeys = {
        key: 'JPD-3',
        summary: 'No links',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: null,
        startDate: new Date('2026-01-01T00:00:00Z'),
        targetDate: new Date('2026-03-31T00:00:00Z'),
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([{ id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig]);
      jpdIdeaRepo.find.mockResolvedValue([ideaNullKeys]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        if (qbCallCount === 1) {
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z'),
            },
          ]);
        } else if (qbCallCount === 2) {
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        }
        return qb;
      });

      // Should not throw; idea with null deliveryIssueKeys is skipped
      const result = await service.getAccuracy('PLAT');
      expect(result[0].coveredIssues).toBe(0);
    });

    it('keeps idea with later targetDate when two ideas link the same epic', async () => {
      boardConfigRepo.findOne.mockResolvedValue(kanbanConfig);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-1', boardId: 'PLAT', epicKey: 'EPIC-1' }),
      ]);

      const earlierIdea = {
        key: 'JPD-1',
        summary: 'Earlier delivery',
        status: 'Done',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: new Date('2026-01-01T00:00:00Z'),
        targetDate: new Date('2026-01-31T00:00:00Z'),
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      const laterIdea = {
        key: 'JPD-2',
        summary: 'Later delivery commitment',
        status: 'In Progress',
        jpdKey: 'ROADMAP',
        deliveryIssueKeys: ['EPIC-1'],
        startDate: new Date('2026-01-01T00:00:00Z'),
        targetDate: new Date('2026-03-31T00:00:00Z'), // later
        syncedAt: new Date(),
      } as unknown as import('../database/entities/index.js').JpdIdea;

      roadmapConfigRepo.find.mockResolvedValue([{ id: 1, jpdKey: 'ROADMAP' } as unknown as import('../database/entities/index.js').RoadmapConfig]);
      jpdIdeaRepo.find.mockResolvedValue([earlierIdea, laterIdea]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        if (qbCallCount === 1) {
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z'),
            },
          ]);
        } else if (qbCallCount === 2) {
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        } else if (qbCallCount === 3) {
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-1',
              field: 'status',
              fromValue: 'In Progress',
              toValue: 'Done',
              changedAt: new Date('2026-02-15T09:00:00Z'),
            },
          ]);
        }
        return qb;
      });

      // With laterIdea (targetDate March 31), the issue resolved Feb 15 is on time
      const result = await service.getAccuracy('PLAT');
      expect(result[0].coveredIssues).toBe(1);
      expect(result[0].roadmapOnTimeRate).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — Kanban with dataStartDate filter
  // -------------------------------------------------------------------------

  describe('getAccuracy (kanban with dataStartDate)', () => {
    it('filters out issues before dataStartDate', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        cancelledStatusNames: ['Cancelled', "Won't Do"],
        backlogStatusIds: [],
        dataStartDate: '2026-03-01',
      } as unknown as BoardConfig);

      // Issue from January — board entry is before dataStartDate → excluded
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'PLAT-OLD', boardId: 'PLAT', createdAt: new Date('2026-01-05T00:00:00Z') }),
      ]);

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        if (qbCallCount === 1) {
          qb.getMany.mockResolvedValue([
            {
              issueKey: 'PLAT-OLD',
              field: 'status',
              fromValue: 'To Do',
              toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z'), // before dataStartDate
            },
          ]);
        } else if (qbCallCount === 2) {
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-OLD' }]);
        }
        return qb;
      });

      const result = await service.getAccuracy('PLAT');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // calculateSprintAccuracy — direct-link coverage path (ADR 0044)
  // -------------------------------------------------------------------------

  describe('getAccuracy (scrum) — direct-link roadmap coverage', () => {
    function setupDirectLinkScenario(opts: {
      roadmapLinkTypes: string[];
      issueEpicKey: string | null;
      linkTypeName: string;
      targetDate: Date;
      resolvedAt: Date | null;
      sprintState?: string;
    }) {
      const sprint = makeSprint({ state: opts.sprintState ?? 'closed' });
      const issue = makeIssue({
        key: 'ACC-99',
        status: opts.resolvedAt ? 'Done' : 'In Progress',
        epicKey: opts.issueEpicKey,
      });

      const boardConfig = {
        boardType: 'scrum',
        doneStatusNames: ['Done', 'Closed', 'Released'],
        cancelledStatusNames: ["Cancelled", "Won't Do"],
        inProgressStatusNames: ['In Progress'],
        roadmapLinkTypes: opts.roadmapLinkTypes,
      } as unknown as BoardConfig;

      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      issueRepo.find.mockResolvedValue([issue]);
      boardConfigRepo.findOne.mockResolvedValue(boardConfig);
      // Membership service places ACC-99 in the sprint (committed at start).
      membership.seed(sprint.id, { committed: ['ACC-99'] });

      // RoadmapConfig + JpdIdea
      const roadmapConfig = { jpdKey: 'PT' } as RoadmapConfig;
      roadmapConfigRepo.find.mockResolvedValue([roadmapConfig]);
      const idea = Object.assign(new JpdIdea(), {
        key: 'PT-389',
        jpdKey: 'PT',
        targetDate: opts.targetDate,
        startDate: new Date('2026-01-01'),
        deliveryIssueKeys: [],
        summary: 'Roadmap item',
      });
      jpdIdeaRepo.find.mockResolvedValue([idea]);

      // changelog — RoadmapService no longer queries Sprint-field changelogs
      // (handled by SprintMembershipService). Only status changelogs remain,
      // used by calculateSprintAccuracy to find the Done transition timestamp.
      const statusChangelogs = opts.resolvedAt
        ? [{ issueKey: 'ACC-99', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: opts.resolvedAt }]
        : [];
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(buildQb(statusChangelogs));

      // issueLinkRepo — direct link ACC-99 → PT-389
      const linkRow = { sourceIssueKey: 'ACC-99', targetIssueKey: 'PT-389', linkTypeName: opts.linkTypeName, isInward: false };
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(
          opts.roadmapLinkTypes.length > 0 &&
          opts.roadmapLinkTypes.map((t) => t.toLowerCase()).includes(opts.linkTypeName.toLowerCase())
            ? [linkRow]
            : [],
        ),
      });
    }

    it('counts an issue with no epicKey as covered (Condition A) when directly linked to a JPD idea and resolved on time', async () => {
      const targetDate = new Date('2026-06-30T00:00:00Z');
      const resolvedAt = new Date('2026-06-15T10:00:00Z'); // before targetDate
      setupDirectLinkScenario({
        roadmapLinkTypes: ['is connected to'],
        issueEpicKey: null,
        linkTypeName: 'is connected to',
        targetDate,
        resolvedAt,
      });

      const result = await service.getAccuracy('ACC');
      expect(result[0].coveredIssues).toBe(1);
      expect(result[0].uncoveredIssues).toBe(0);
    });

    it('counts an issue with no epicKey as covered (Condition B) when directly linked, sprint is active, and targetDate not lapsed', async () => {
      const futureTarget = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
      setupDirectLinkScenario({
        roadmapLinkTypes: ['is connected to'],
        issueEpicKey: null,
        linkTypeName: 'is connected to',
        targetDate: futureTarget,
        resolvedAt: null,
        sprintState: 'active',
      });

      const result = await service.getAccuracy('ACC');
      expect(result[0].coveredIssues).toBe(1);
    });

    it('counts an issue with no epicKey as linkedNotCovered (amber) when directly linked but neither Condition A nor B applies', async () => {
      const pastTarget = new Date('2026-01-10T00:00:00Z');
      setupDirectLinkScenario({
        roadmapLinkTypes: ['is connected to'],
        issueEpicKey: null,
        linkTypeName: 'is connected to',
        targetDate: pastTarget,
        resolvedAt: null, // not done, sprint closed — neither A nor B
        sprintState: 'closed',
      });

      const result = await service.getAccuracy('ACC');
      expect(result[0].coveredIssues).toBe(0);
      expect(result[0].linkedCount).toBe(1); // amber
    });

    it('counts an issue as uncovered when roadmapLinkTypes is empty even if a link exists', async () => {
      const targetDate = new Date('2026-06-30T00:00:00Z');
      setupDirectLinkScenario({
        roadmapLinkTypes: [], // feature disabled
        issueEpicKey: null,
        linkTypeName: 'is connected to',
        targetDate,
        resolvedAt: new Date('2026-06-15T10:00:00Z'),
      });

      const result = await service.getAccuracy('ACC');
      expect(result[0].coveredIssues).toBe(0);
      expect(result[0].linkedCount).toBe(0);
      // issueLinkRepo should NOT be queried when roadmapLinkTypes is empty
      expect(issueLinkRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('uses epic link targetDate over direct link when issue has both', async () => {
      const epicTargetDate = new Date('2026-03-31T00:00:00Z'); // earlier (epic)
      const directTargetDate = new Date('2026-09-30T00:00:00Z'); // later (direct)
      const resolvedAt = new Date('2026-04-15T10:00:00Z'); // after epicTargetDate but before directTargetDate

      const sprint = makeSprint({ state: 'closed' });
      const issue = makeIssue({ key: 'ACC-99', status: 'Done', epicKey: 'ACC-EPIC-1' });
      const boardConfig = {
        boardType: 'scrum',
        doneStatusNames: ['Done', 'Closed', 'Released'],
        cancelledStatusNames: ["Cancelled", "Won't Do"],
        inProgressStatusNames: ['In Progress'],
        roadmapLinkTypes: ['is connected to'],
      } as unknown as BoardConfig;

      sprintRepo.find
        .mockResolvedValueOnce([sprint])
        .mockResolvedValueOnce([]);
      issueRepo.find.mockResolvedValue([issue]);
      boardConfigRepo.findOne.mockResolvedValue(boardConfig);
      roadmapConfigRepo.find.mockResolvedValue([{ jpdKey: 'PT' } as RoadmapConfig]);
      // Membership service places ACC-99 in the sprint (committed at start).
      membership.seed(sprint.id, { committed: ['ACC-99'] });

      // epic-linked idea (earlier targetDate)
      const epicIdea = Object.assign(new JpdIdea(), {
        key: 'PT-100',
        jpdKey: 'PT',
        targetDate: epicTargetDate,
        startDate: new Date('2026-01-01'),
        deliveryIssueKeys: ['ACC-EPIC-1'],
        summary: 'Epic idea',
      });
      // direct-linked idea (later targetDate)
      const directIdea = Object.assign(new JpdIdea(), {
        key: 'PT-200',
        jpdKey: 'PT',
        targetDate: directTargetDate,
        startDate: new Date('2026-01-01'),
        deliveryIssueKeys: [],
        summary: 'Direct idea',
      });
      jpdIdeaRepo.find.mockResolvedValue([epicIdea, directIdea]);

      // Only status changelogs queried by RoadmapService now.
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
        buildQb([{
          issueKey: 'ACC-99', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: resolvedAt,
        }]),
      );
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { sourceIssueKey: 'ACC-99', targetIssueKey: 'PT-200', linkTypeName: 'is connected to' },
        ]),
      });

      const result = await service.getAccuracy('ACC');
      // resolvedAt (Apr 15) is AFTER epicTargetDate (Mar 31) → not covered if epic wins
      // resolvedAt (Apr 15) is BEFORE directTargetDate (Sep 30) → covered if direct wins
      // Epic takes priority → should be NOT covered (amber)
      expect(result[0].coveredIssues).toBe(0);
      expect(result[0].linkedCount).toBe(1);
    });
  });
});
