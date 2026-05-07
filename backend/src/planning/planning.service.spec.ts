import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlanningService } from './planning.service.js';
import { Repository } from 'typeorm';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  BoardConfig,
} from '../database/entities/index.js';
import {
  SprintMembershipService,
  SprintMembership,
} from '../sprint-membership/sprint-membership.service.js';

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

function mockConfigService(): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation(
      (_key: string, defaultValue?: unknown) => defaultValue ?? 'UTC',
    ),
  } as unknown as jest.Mocked<ConfigService>;
}

function emptyMembership(): SprintMembership {
  return {
    committedKeys: new Set<string>(),
    addedKeys: new Set<string>(),
    committedRemovedKeys: new Set<string>(),
        addedRemovedKeys: new Set<string>(),
    currentMemberKeys: new Set<string>(),
    logsByIssue: new Map<string, JiraChangelog[]>(),
  };
}

function mockSprintMembership(): {
  service: jest.Mocked<SprintMembershipService>;
  reconstruct: jest.Mock;
} {
  const reconstruct = jest.fn().mockResolvedValue(emptyMembership());
  return {
    service: { reconstruct } as unknown as jest.Mocked<SprintMembershipService>,
    reconstruct,
  };
}

describe('PlanningService', () => {
  let service: PlanningService;
  let sprintRepo: jest.Mocked<Repository<JiraSprint>>;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let membershipReconstruct: jest.Mock;

  beforeEach(() => {
    sprintRepo = mockRepo<JiraSprint>();
    issueRepo = mockRepo<JiraIssue>();
    changelogRepo = mockRepo<JiraChangelog>();
    boardConfigRepo = mockRepo<BoardConfig>();

    const membership = mockSprintMembership();
    membershipReconstruct = membership.reconstruct;

    service = new PlanningService(
      sprintRepo,
      issueRepo,
      changelogRepo,
      boardConfigRepo,
      mockConfigService(),
      membership.service,
    );
  });

  // -------------------------------------------------------------------------
  // getAccuracy — Kanban + empty
  // -------------------------------------------------------------------------

  describe('getAccuracy', () => {
    it('should throw for Kanban boards', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        inProgressStatusNames: ['In Progress'],
        dataStartDate: null,
      } as unknown as BoardConfig);

      await expect(service.getAccuracy('PLAT')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getAccuracy('PLAT')).rejects.toThrow(
        'Planning accuracy is not available for Kanban boards',
      );
    });

    it('should return empty array when no sprints found', async () => {
      sprintRepo.find.mockResolvedValue([]);

      const result = await service.getAccuracy('ACC');

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Orchestration: PlanningService composes membership + completion + points
  //
  // The membership reconstruction algorithm itself is covered in
  // sprint-membership.service.spec.ts (see ADR 0049). These tests verify
  // PlanningService correctly maps a SprintMembership into a SprintAccuracy.
  // -------------------------------------------------------------------------

  describe('getAccuracy orchestration', () => {
    const sprint: JiraSprint = {
      id: 'sprint-1',
      name: 'Sprint 1',
      boardId: 'ACC',
      state: 'closed',
      startDate: new Date('2025-01-01T00:00:00Z'),
      endDate: new Date('2025-01-14T23:59:59Z'),
      goal: '',
    } as JiraSprint;

    const activeSprint: JiraSprint = {
      ...sprint,
      state: 'active',
      endDate: null as unknown as Date,
    } as JiraSprint;

    function setBoardSprints(sprints: JiraSprint[]): void {
      sprintRepo.find
        .mockResolvedValueOnce(sprints.filter((s) => s.state === 'closed'))
        .mockResolvedValueOnce(sprints.filter((s) => s.state === 'active'));
    }

    it('uses status changelog to detect completion in closed sprints', async () => {
      setBoardSprints([sprint]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', status: 'In Progress', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1', 'ACC-2']),
        addedKeys: new Set<string>(),
        committedRemovedKeys: new Set<string>(),
        addedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1', 'ACC-2']),
        logsByIssue: new Map(),
      });

      // Status changelog: only ACC-1 transitioned to Done before sprint end
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { issueKey: 'ACC-1', field: 'status', toValue: 'Done',
            changedAt: new Date('2025-01-10T00:00:00Z') },
        ] as unknown as JiraChangelog[]),
      });

      const result = await service.getAccuracy('ACC');

      expect(result).toHaveLength(1);
      expect(result[0].commitment).toBe(2);
      expect(result[0].completed).toBe(1);
      expect(result[0].completionRate).toBe(50);
    });

    // ── D-2 regression (proposal 0055) ────────────────────────────────────
    // Carry-over scenario: an issue completed in a *previous* sprint must
    // NOT be counted as completed in this sprint, even when it is added
    // back to this sprint for follow-up work. Before the fix, the
    // completion check only enforced an upper bound (changedAt <= sprint.endDate),
    // so any pre-sprint Done transition counted.  After the fix the check
    // requires changedAt >= sprint.startDate − GRACE.
    it('does NOT count a Done transition that pre-dates the sprint start (D-2 regression)', async () => {
      setBoardSprints([sprint]); // 2025-01-01 → 2025-01-14

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1']),
        addedKeys: new Set<string>(),
        committedRemovedKeys: new Set<string>(),
        addedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1']),
        logsByIssue: new Map(),
      });

      // Done transition occurred the day before sprint start — must be ignored.
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { issueKey: 'ACC-1', field: 'status', toValue: 'Done',
            changedAt: new Date('2024-12-31T12:00:00Z') },
        ] as unknown as JiraChangelog[]),
      });

      const result = await service.getAccuracy('ACC');

      expect(result[0].commitment).toBe(1);
      expect(result[0].completed).toBe(0);
    });

    it('counts a Done transition inside the sprint window (D-2 positive case)', async () => {
      setBoardSprints([sprint]); // 2025-01-01 → 2025-01-14

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1']),
        addedKeys: new Set<string>(),
        committedRemovedKeys: new Set<string>(),
        addedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1']),
        logsByIssue: new Map(),
      });

      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { issueKey: 'ACC-1', field: 'status', toValue: 'Done',
            changedAt: new Date('2025-01-10T00:00:00Z') },
        ] as unknown as JiraChangelog[]),
      });

      const result = await service.getAccuracy('ACC');

      expect(result[0].completed).toBe(1);
    });

    it('uses current status as completion proxy for active sprints', async () => {
      setBoardSprints([activeSprint]);

      issueRepo.find.mockResolvedValue([
        // ACC-1 currently Done — counted as complete via status proxy
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', status: 'In Progress', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1', 'ACC-2']),
        addedKeys: new Set<string>(),
        committedRemovedKeys: new Set<string>(),
        addedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1', 'ACC-2']),
        logsByIssue: new Map(),
      });

      // No status changelog at all — completion must come from current status
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getAccuracy('ACC');

      expect(result[0].state).toBe('active');
      expect(result[0].completed).toBe(1);
    });

    it('computes scopeChangePercent from added + removed / commitment', async () => {
      setBoardSprints([sprint]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-3', boardId: 'ACC', issueType: 'Story', status: 'To Do', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-4', boardId: 'ACC', issueType: 'Story', status: 'To Do', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4']),
        addedKeys: new Set(['ACC-5']),                  // 1 added
        committedRemovedKeys: new Set(['ACC-4']),       // 1 committed-removed
        addedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3', 'ACC-5']),
        logsByIssue: new Map(),
      });

      const result = await service.getAccuracy('ACC');

      expect(result[0].commitment).toBe(4);
      expect(result[0].added).toBe(1);
      expect(result[0].removed).toBe(1);
      // scopeChangePercent = (1 + 1) / 4 * 100 = 50
      expect(result[0].scopeChangePercent).toBe(50);
    });

    // ── Proposal 0050 regression ──────────────────────────────────────────
    // Five issues are added mid-sprint then removed before sprint end. Under
    // the old single-`removedKeys` shape these issues appeared in BOTH
    // `addedKeys` and `removedKeys`, double-counting them in
    // `scopeChange% = (added + removed) / commitment * 100`.
    //
    // After the split, `removed` is committed-removed only — so
    // add-then-remove churn contributes via `added` exactly once.
    it('does not double-count add-then-remove churn in scopeChangePercent (proposal 0050)', async () => {
      setBoardSprints([sprint]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'To Do', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', status: 'To Do', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-3', boardId: 'ACC', issueType: 'Story', status: 'To Do', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-4', boardId: 'ACC', issueType: 'Story', status: 'To Do', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4']),
        addedKeys: new Set(['ACC-5', 'ACC-6', 'ACC-7', 'ACC-8', 'ACC-9']),
        addedRemovedKeys: new Set(['ACC-5', 'ACC-6', 'ACC-7', 'ACC-8', 'ACC-9']),
        committedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4']),
        logsByIssue: new Map(),
      });

      const result = await service.getAccuracy('ACC');

      expect(result[0].commitment).toBe(4);
      expect(result[0].added).toBe(5);    // gross
      expect(result[0].removed).toBe(0);  // no committed-removed
      // (5 added + 0 committed-removed) / 4 * 100 = 125
      // (NOT the buggy (5 + 5) / 4 * 100 = 250)
      expect(result[0].scopeChangePercent).toBe(125);
      // completionRate divisor = currentMemberKeys.size (= 4), per ADR 0052.
      // No Done changelog rows are mocked and all four current members are
      // 'To Do', so completed = 0 → completionRate = 0 / 4 * 100 = 0.
      expect(result[0].completionRate).toBe(0);
    });

    it('computes points-based planningAccuracy when issues have story points', async () => {
      setBoardSprints([sprint]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: 5, createdAt: new Date('2024-12-01') },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', status: 'Done', points: 3, createdAt: new Date('2024-12-01') },
        { key: 'ACC-3', boardId: 'ACC', issueType: 'Story', status: 'In Progress', points: 2, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3']),
        addedKeys: new Set<string>(),
        committedRemovedKeys: new Set<string>(),
        addedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3']),
        logsByIssue: new Map(),
      });

      // ACC-1 and ACC-2 transitioned to Done before end
      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { issueKey: 'ACC-1', field: 'status', toValue: 'Done',
            changedAt: new Date('2025-01-10T00:00:00Z') },
          { issueKey: 'ACC-2', field: 'status', toValue: 'Done',
            changedAt: new Date('2025-01-12T00:00:00Z') },
        ] as unknown as JiraChangelog[]),
      });

      const result = await service.getAccuracy('ACC');

      // committedPoints = 5+3+2 = 10; completedPoints = 5+3 = 8
      expect(result[0].committedPoints).toBe(10);
      expect(result[0].completedPoints).toBe(8);
      expect(result[0].planningAccuracy).toBe(80);
    });

    it('falls back to ticket-count planningAccuracy when all committed issues lack points', async () => {
      setBoardSprints([sprint]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Story', status: 'In Progress', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      membershipReconstruct.mockResolvedValue({
        committedKeys: new Set(['ACC-1', 'ACC-2']),
        addedKeys: new Set<string>(),
        committedRemovedKeys: new Set<string>(),
        addedRemovedKeys: new Set<string>(),
        currentMemberKeys: new Set(['ACC-1', 'ACC-2']),
        logsByIssue: new Map(),
      });

      changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          { issueKey: 'ACC-1', field: 'status', toValue: 'Done',
            changedAt: new Date('2025-01-10T00:00:00Z') },
        ] as unknown as JiraChangelog[]),
      });

      const result = await service.getAccuracy('ACC');

      // null signals ticket-count fallback
      expect(result[0].committedPoints).toBeNull();
      expect(result[0].completedPoints).toBeNull();
      // 1 of 2 committed → 50% by ticket count
      expect(result[0].planningAccuracy).toBe(50);
    });

    it('returns empty accuracy when board has no work-item issues', async () => {
      setBoardSprints([sprint]);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getAccuracy('ACC');

      expect(result).toHaveLength(1);
      expect(result[0].commitment).toBe(0);
      expect(result[0].planningAccuracy).toBeNull();
      // membership service should not even be invoked when no work items exist
      expect(membershipReconstruct).not.toHaveBeenCalled();
    });

    it('passes the sprint and board issues to SprintMembershipService.reconstruct', async () => {
      setBoardSprints([sprint]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      await service.getAccuracy('ACC');

      expect(membershipReconstruct).toHaveBeenCalledTimes(1);
      const arg = membershipReconstruct.mock.calls[0][0];
      expect(arg.sprint.id).toBe('sprint-1');
      expect(arg.boardId).toBe('ACC');
      expect(arg.boardIssues.map((i: JiraIssue) => i.key)).toEqual(['ACC-1']);
    });

    it('excludes Epics and Sub-tasks from boardIssues passed to membership service', async () => {
      setBoardSprints([sprint]);

      issueRepo.find.mockResolvedValue([
        { key: 'ACC-1', boardId: 'ACC', issueType: 'Story', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-2', boardId: 'ACC', issueType: 'Epic', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
        { key: 'ACC-3', boardId: 'ACC', issueType: 'Sub-task', status: 'Done', points: null, createdAt: new Date('2024-12-01') },
      ] as unknown as JiraIssue[]);

      await service.getAccuracy('ACC');

      const arg = membershipReconstruct.mock.calls[0][0];
      expect(arg.boardIssues.map((i: JiraIssue) => i.key)).toEqual(['ACC-1']);
    });
  });

  // -------------------------------------------------------------------------
  // getSprints
  // -------------------------------------------------------------------------

  describe('getSprints', () => {
    it('should return sprints for a board', async () => {
      sprintRepo.find.mockResolvedValue([
        { id: 's1', name: 'Sprint 1', state: 'closed', boardId: 'ACC' },
        { id: 's2', name: 'Sprint 2', state: 'active', boardId: 'ACC' },
      ] as JiraSprint[]);

      const result = await service.getSprints('ACC');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 's1',
        name: 'Sprint 1',
        state: 'closed',
      });
    });
  });

  // -------------------------------------------------------------------------
  // getQuarters
  // -------------------------------------------------------------------------

  describe('getQuarters', () => {
    it('should extract unique quarters from sprint dates', async () => {
      sprintRepo.find.mockResolvedValue([
        { id: 's1', state: 'closed', startDate: new Date('2025-01-10') },
        { id: 's2', state: 'closed', startDate: new Date('2025-01-24') },
        { id: 's3', state: 'closed', startDate: new Date('2025-04-01') },
      ] as JiraSprint[]);

      const result = await service.getQuarters();

      expect(result).toHaveLength(2);
      expect(result[0].quarter).toBe('2025-Q2');
      expect(result[1].quarter).toBe('2025-Q1');
    });

    it('should return empty array when no sprints', async () => {
      sprintRepo.find.mockResolvedValue([]);
      const result = await service.getQuarters();
      expect(result).toEqual([]);
    });

    it('should skip sprints with no startDate', async () => {
      sprintRepo.find.mockResolvedValue([
        { id: 's1', state: 'closed', startDate: null } as unknown as JiraSprint,
        { id: 's2', state: 'closed', startDate: new Date('2025-01-10') } as unknown as JiraSprint,
      ]);

      const result = await service.getQuarters();
      expect(result).toHaveLength(1);
      expect(result[0].quarter).toBe('2025-Q1');
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — sprintId path
  // -------------------------------------------------------------------------

  describe('getAccuracy with sprintId', () => {
    it('returns accuracy for a single sprint by id', async () => {
      const sprint: JiraSprint = {
        id: 'sprint-5',
        name: 'Sprint 5',
        boardId: 'ACC',
        state: 'closed',
        startDate: new Date('2026-01-06'),
        endDate: new Date('2026-01-20'),
        goal: '',
      } as JiraSprint;

      sprintRepo.findOne.mockResolvedValue(sprint);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getAccuracy('ACC', 'sprint-5');

      expect(sprintRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sprint-5', boardId: 'ACC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].sprintId).toBe('sprint-5');
    });

    it('returns empty array when sprintId not found', async () => {
      sprintRepo.findOne.mockResolvedValue(null);
      const result = await service.getAccuracy('ACC', 'nonexistent');
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAccuracy — quarter path
  // -------------------------------------------------------------------------

  describe('getAccuracy with quarter', () => {
    it('uses createQueryBuilder to fetch sprints in quarter date range', async () => {
      const qbMock = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      sprintRepo.createQueryBuilder = jest.fn().mockReturnValue(qbMock);

      const result = await service.getAccuracy('ACC', undefined, '2026-Q1');

      expect(sprintRepo.createQueryBuilder).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getKanbanQuarters
  // -------------------------------------------------------------------------

  describe('getKanbanQuarters', () => {
    it('throws BadRequestException when board is not Kanban', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'ACC',
        boardType: 'scrum',
      } as unknown as BoardConfig);

      await expect(service.getKanbanQuarters('ACC')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no board config exists', async () => {
      boardConfigRepo.findOne.mockResolvedValue(null);
      await expect(service.getKanbanQuarters('PLAT')).rejects.toThrow(BadRequestException);
    });

    it('returns empty array when kanban board has no issues', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getKanbanQuarters('PLAT');
      expect(result).toEqual([]);
    });

    it('returns empty array when all issues are backlog (no status changelogs)', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);
      issueRepo.find.mockResolvedValue([
        { key: 'PLAT-1', boardId: 'PLAT', issueType: 'Story', summary: 'S', status: 'To Do',
          labels: [], epicKey: null, fixVersion: null, sprintId: null, createdAt: new Date('2026-01-05T00:00:00Z'),
          priority: null, points: null, statusId: null } as unknown as JiraIssue,
      ]);

      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        return qb;
      });

      const result = await service.getKanbanQuarters('PLAT');
      expect(result).toEqual([]);
    });

    it('groups issues into quarters by board-entry date', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);

      issueRepo.find.mockResolvedValue([
        { key: 'PLAT-1', boardId: 'PLAT', issueType: 'Story', summary: 'S', status: 'Done',
          labels: [], epicKey: null, fixVersion: null, sprintId: null, createdAt: new Date('2026-01-01T00:00:00Z'),
          priority: null, points: null, statusId: null } as unknown as JiraIssue,
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
            { issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress',
              changedAt: new Date('2026-01-10T09:00:00Z') },
          ]);
        } else if (qbCallCount === 2) {
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        } else if (qbCallCount === 3) {
          qb.getMany.mockResolvedValue([
            { issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done',
              changedAt: new Date('2026-01-20T09:00:00Z') },
          ]);
        }
        return qb;
      });

      const result = await service.getKanbanQuarters('PLAT');
      expect(result).toHaveLength(1);
      expect(result[0].quarter).toBe('2026-Q1');
      expect(result[0].issuesPulledIn).toBe(1);
      expect(result[0].completed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getKanbanWeeks
  // -------------------------------------------------------------------------

  describe('getKanbanWeeks', () => {
    it('throws BadRequestException when board is not Kanban', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'ACC',
        boardType: 'scrum',
      } as unknown as BoardConfig);

      await expect(service.getKanbanWeeks('ACC')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no board config exists', async () => {
      boardConfigRepo.findOne.mockResolvedValue(null);
      await expect(service.getKanbanWeeks('PLAT')).rejects.toThrow(BadRequestException);
    });

    it('returns empty array when kanban board has no issues', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);
      issueRepo.find.mockResolvedValue([]);

      const result = await service.getKanbanWeeks('PLAT');
      expect(result).toEqual([]);
    });

    it('groups issues into weeks by board-entry date', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);

      issueRepo.find.mockResolvedValue([
        { key: 'PLAT-1', boardId: 'PLAT', issueType: 'Story', summary: 'S', status: 'Done',
          labels: [], epicKey: null, fixVersion: null, sprintId: null, createdAt: new Date('2026-01-01T00:00:00Z'),
          priority: null, points: null, statusId: null } as unknown as JiraIssue,
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
            { issueKey: 'PLAT-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress',
              changedAt: new Date('2026-01-06T09:00:00Z') },
          ]);
        } else if (qbCallCount === 2) {
          qb.getRawMany.mockResolvedValue([{ issueKey: 'PLAT-1' }]);
        } else if (qbCallCount === 3) {
          qb.getMany.mockResolvedValue([
            { issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done',
              changedAt: new Date('2026-01-08T09:00:00Z') },
          ]);
        }
        return qb;
      });

      const result = await service.getKanbanWeeks('PLAT');
      expect(result).toHaveLength(1);
      expect(result[0].week).toBe('2026-W02');
      expect(result[0].issuesPulledIn).toBe(1);
      expect(result[0].completed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // C-3: boardEntryStatuses — configurable board-entry status list
  // -------------------------------------------------------------------------

  describe('C-3: boardEntryStatuses', () => {
    it('queries board-entry using toValue IN boardEntryStatuses (not fromValue = To Do)', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        backlogStatusIds: [],
        dataStartDate: null,
        boardEntryStatuses: ['Backlog', 'To Do', 'Open'],
      } as unknown as BoardConfig);

      issueRepo.find.mockResolvedValue([
        {
          key: 'PLAT-1', boardId: 'PLAT', issueType: 'Story', summary: 'S',
          status: 'Done', labels: [], epicKey: null, fixVersion: null, createdAt: new Date('2025-12-01T00:00:00Z'),
          priority: null, points: null, statusId: null,
        } as unknown as JiraIssue,
      ]);

      const firstQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            issueKey: 'PLAT-1', field: 'status', fromValue: null,
            toValue: 'Backlog',
            changedAt: new Date('2026-01-05T09:00:00Z'),
          },
        ]),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        if (qbCallCount === 1) return firstQb;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([{ issueKey: 'PLAT-1' }]),
        };
        return qb;
      });

      await service.getKanbanQuarters('PLAT');

      const andWhereCalls = firstQb.andWhere.mock.calls.map((c) => c[0]);
      expect(andWhereCalls).not.toContain('cl.fromValue = :from');
      expect(andWhereCalls.some((c: string) => c.includes('toValue IN'))).toBe(true);
    });

    it('includes extended default statuses (Backlog, Open, New) when not configured', async () => {
      boardConfigRepo.findOne.mockResolvedValue({
        boardId: 'PLAT',
        boardType: 'kanban',
        doneStatusNames: ['Done'],
        backlogStatusIds: [],
        dataStartDate: null,
      } as unknown as BoardConfig);

      issueRepo.find.mockResolvedValue([
        {
          key: 'PLAT-2', boardId: 'PLAT', issueType: 'Story', summary: 'T',
          status: 'Done', labels: [], epicKey: null, fixVersion: null, createdAt: new Date('2025-11-01T00:00:00Z'),
          priority: null, points: null, statusId: null,
        } as unknown as JiraIssue,
      ]);

      const firstQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
        getRawMany: jest.fn().mockResolvedValue([]),
      };

      let qbCallCount = 0;
      changelogRepo.createQueryBuilder = jest.fn().mockImplementation(() => {
        qbCallCount++;
        if (qbCallCount === 1) return firstQb;
        const qb = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          getMany: jest.fn().mockResolvedValue([]),
          getRawMany: jest.fn().mockResolvedValue([]),
        };
        return qb;
      });

      await service.getKanbanQuarters('PLAT');

      const andWhereCalls = firstQb.andWhere.mock.calls;
      const statusesCall = andWhereCalls.find((c) =>
        typeof c[0] === 'string' && c[0].includes('toValue IN'),
      );
      expect(statusesCall).toBeDefined();
      const statusesArg = statusesCall![1] as { statuses: string[] };
      expect(statusesArg.statuses).toContain('To Do');
      expect(statusesArg.statuses).toContain('Backlog');
      expect(statusesArg.statuses).toContain('Open');
      expect(statusesArg.statuses).toContain('New');
    });
  });
});
