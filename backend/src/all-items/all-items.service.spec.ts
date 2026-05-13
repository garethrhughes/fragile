/**
 * Unit tests for AllItemsService
 *
 * NOTE: Bespoke MyPass-only report (feature 0012, proposal 0062).
 * Tests are isolated — no shared mutable state, all repos mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BoardConfig,
  JiraIssue,
  JiraChangelog,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';
import { AllItemsService } from './all-items.service.js';
import { SprintMembershipService } from '../sprint-membership/sprint-membership.service.js';
import type { SprintMembership } from '../sprint-membership/sprint-membership.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBoard(overrides: Partial<BoardConfig> = {}): BoardConfig {
  const b = new BoardConfig();
  b.boardId = 'ACC';
  b.boardType = 'scrum';
  b.doneStatusNames = ['Done'];
  b.inProgressStatusNames = ['In Progress'];
  b.cancelledStatusNames = ['Cancelled'];
  b.boardEntryStatuses = ['To Do'];
  b.backlogStatusIds = [];
  b.roadmapLinkTypes = [];
  b.supportLabels = [];
  b.supportLinkTypes = [];
  b.supportEpics = [];
  b.triageBoardKey = null;
  b.failureIssueTypes = [];
  b.failureLabels = [];
  b.incidentIssueTypes = [];
  b.incidentLabels = [];
  b.incidentPriorities = [];
  return Object.assign(b, overrides);
}

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  const i = new JiraIssue();
  i.key = 'ACC-1';
  i.summary = 'Test issue';
  i.issueType = 'Story';
  i.status = 'To Do';
  i.statusId = null;
  i.boardId = 'ACC';
  i.epicKey = null;
  i.labels = [];
  i.points = null;
  i.priority = null;
  i.assignee = null;
  i.fixVersion = null;
  i.createdAt = new Date('2026-05-05T00:00:00Z');
  i.updatedAt = new Date('2026-05-05T00:00:00Z');
  return Object.assign(i, overrides);
}

function makeChangelog(overrides: Partial<JiraChangelog> = {}): JiraChangelog {
  const cl = new JiraChangelog();
  cl.id = 1;
  cl.issueKey = 'ACC-1';
  cl.field = 'status';
  cl.fromValue = 'To Do';
  cl.toValue = 'In Progress';
  cl.fromId = null;
  cl.toId = null;
  cl.changedAt = new Date('2026-05-12T09:00:00Z');
  return Object.assign(cl, overrides);
}

function makeSprint(overrides: Partial<JiraSprint> = {}): JiraSprint {
  const s = new JiraSprint();
  s.id = 'sprint-1';
  s.name = 'Sprint 1';
  s.state = 'active';
  s.boardId = 'ACC';
  s.startDate = new Date('2026-05-11T00:00:00Z');
  s.endDate = new Date('2026-05-24T23:59:59Z');
  return Object.assign(s, overrides);
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AllItemsService', () => {
  let service: AllItemsService;
  let boardConfigRepo: { find: jest.Mock; findOne: jest.Mock };
  let issueRepo: { find: jest.Mock };
  let changelogRepo: { createQueryBuilder: jest.Mock };
  let sprintRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let issueLinkRepo: { createQueryBuilder: jest.Mock };
  let jpdIdeaRepo: { find: jest.Mock };
  let roadmapConfigRepo: { find: jest.Mock };
  let sprintMembership: { reconstructMany: jest.Mock };

  function makeQb(rows: unknown[]) {
    const qb: Record<string, jest.Mock> = {};
    qb.where = jest.fn().mockReturnValue(qb);
    qb.andWhere = jest.fn().mockReturnValue(qb);
    qb.orderBy = jest.fn().mockReturnValue(qb);
    qb.select = jest.fn().mockReturnValue(qb);
    qb.getMany = jest.fn().mockResolvedValue(rows);
    qb.getOne = jest.fn().mockResolvedValue(rows[0] ?? null);
    return qb;
  }

  beforeEach(async () => {
    boardConfigRepo = { find: jest.fn(), findOne: jest.fn() };
    issueRepo = { find: jest.fn() };
    changelogRepo = { createQueryBuilder: jest.fn() };
    sprintRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
    issueLinkRepo = { createQueryBuilder: jest.fn() };
    jpdIdeaRepo = { find: jest.fn() };
    roadmapConfigRepo = { find: jest.fn() };
    sprintMembership = { reconstructMany: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllItemsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: unknown) => {
              if (key === 'JIRA_BASE_URL') return 'https://jira.example.com';
              if (key === 'TIMEZONE') return 'UTC';
              return def;
            }),
          },
        },
        { provide: getRepositoryToken(BoardConfig), useValue: boardConfigRepo },
        { provide: getRepositoryToken(JiraIssue), useValue: issueRepo },
        { provide: getRepositoryToken(JiraChangelog), useValue: changelogRepo },
        { provide: getRepositoryToken(JiraSprint), useValue: sprintRepo },
        { provide: getRepositoryToken(JiraIssueLink), useValue: issueLinkRepo },
        { provide: getRepositoryToken(JpdIdea), useValue: jpdIdeaRepo },
        { provide: getRepositoryToken(RoadmapConfig), useValue: roadmapConfigRepo },
        { provide: SprintMembershipService, useValue: sprintMembership },
      ],
    }).compile();

    service = module.get(AllItemsService);
  });

  // -------------------------------------------------------------------------
  // Returns empty response when no boards configured
  // -------------------------------------------------------------------------

  it('returns empty boards array when no board configs exist', async () => {
    boardConfigRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards).toHaveLength(0);
    expect(result.totals.totalItems).toBe(0);
    expect(result.week).toBe('2026-W20');
  });

  // -------------------------------------------------------------------------
  // Returns empty board result when board has no issues
  // -------------------------------------------------------------------------

  it('returns empty board result when board has no work items', async () => {
    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards).toHaveLength(1);
    expect(result.boards[0].items).toHaveLength(0);
    expect(result.boards[0].healthScore.overall).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Excludes epics and subtasks
  // -------------------------------------------------------------------------

  it('excludes epics and subtasks from results', async () => {
    const epic = makeIssue({ key: 'ACC-0', issueType: 'Epic' });
    const subtask = makeIssue({ key: 'ACC-2', issueType: 'Sub-task' });
    const story = makeIssue({ key: 'ACC-1', issueType: 'Story' });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([epic, subtask, story]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    const keys = result.boards[0].items.map((i) => i.key);
    expect(keys).not.toContain('ACC-0');
    expect(keys).not.toContain('ACC-2');
  });

  // -------------------------------------------------------------------------
  // Detects started flag (first in-progress transition in week)
  // -------------------------------------------------------------------------

  it('marks started=true when first in-progress transition occurs within the week', async () => {
    const issue = makeIssue({ key: 'ACC-1', issueType: 'Story', status: 'In Progress' });
    const cl = makeChangelog({
      issueKey: 'ACC-1',
      field: 'status',
      fromValue: 'To Do',
      toValue: 'In Progress',
      changedAt: new Date('2026-05-12T09:00:00Z'), // 2026-W20
    });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.started).toBe(true);
  });

  it('marks started=false when in-progress transition is before the week', async () => {
    const issue = makeIssue({ key: 'ACC-1', issueType: 'Story', status: 'In Progress' });
    const cl = makeChangelog({
      issueKey: 'ACC-1',
      field: 'status',
      fromValue: 'To Do',
      toValue: 'In Progress',
      changedAt: new Date('2026-05-04T09:00:00Z'), // 2026-W19
    });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.started).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Detects completed flag
  // -------------------------------------------------------------------------

  it('marks completed=true when done transition occurs within the week', async () => {
    const issue = makeIssue({ key: 'ACC-1', issueType: 'Story', status: 'Done' });
    const cl = makeChangelog({
      issueKey: 'ACC-1',
      field: 'status',
      fromValue: 'In Progress',
      toValue: 'Done',
      changedAt: new Date('2026-05-13T14:00:00Z'), // 2026-W20
    });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.completed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Detects addedMidSprint flag (scrum)
  // -------------------------------------------------------------------------

  it('marks addedMidSprint=true for scrum issue added to sprint after sprint start', async () => {
    const sprint = makeSprint({
      id: 'sprint-1',
      startDate: new Date('2026-05-11T00:00:00Z'),
      endDate: new Date('2026-05-24T23:59:59Z'),
    });
    const issue = makeIssue({ key: 'ACC-1', issueType: 'Story' });

    const membership: SprintMembership = {
      committedKeys: new Set(),
      addedKeys: new Set(['ACC-1']),
      committedRemovedKeys: new Set(),
      addedRemovedKeys: new Set(),
      currentMemberKeys: new Set(['ACC-1']),
      logsByIssue: new Map(),
    };

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([sprint]);
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membership]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.addedMidSprint).toBe(true);
    expect(item?.kanbanAdd).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Detects kanbanAdd flag
  // -------------------------------------------------------------------------

  it('marks kanbanAdd=true for kanban issue whose board-entry date is within the week', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const issue = makeIssue({ key: 'PLAT-1', issueType: 'Story', boardId: 'PLAT' });
    const cl = makeChangelog({
      issueKey: 'PLAT-1',
      field: 'status',
      fromValue: null,
      toValue: 'To Do',
      changedAt: new Date('2026-05-12T08:00:00Z'), // 2026-W20
    });

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'PLAT-1');

    expect(item?.kanbanAdd).toBe(true);
    expect(item?.addedMidSprint).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Support detection
  // -------------------------------------------------------------------------

  it('marks isSupport=true when issue has a support label', async () => {
    const board = makeBoard({ supportLabels: ['support'] });
    const issue = makeIssue({ key: 'ACC-1', issueType: 'Story', labels: ['support'] });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.isSupport).toBe(true);
  });

  it('marks isTtbSupport=true when issue has a TTB triage link', async () => {
    const board = makeBoard({
      supportLinkTypes: ['clones'],
      triageBoardKey: 'TTB',
    });
    const issue = makeIssue({ key: 'ACC-1', issueType: 'Story' });
    const link = Object.assign(new JiraIssueLink(), {
      id: 1,
      sourceIssueKey: 'ACC-1',
      targetIssueKey: 'TTB-42',
      linkTypeName: 'clones',
    });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([link]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.isTtbSupport).toBe(true);
    expect(item?.isSupport).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Filter: added-mid-sprint
  // -------------------------------------------------------------------------

  it('filter=added-mid-sprint returns only items with addedMidSprint=true', async () => {
    const sprint = makeSprint();
    const addedIssue = makeIssue({ key: 'ACC-1', issueType: 'Story' });
    const committedIssue = makeIssue({ key: 'ACC-2', issueType: 'Story' });

    const membership: SprintMembership = {
      committedKeys: new Set(['ACC-2']),
      addedKeys: new Set(['ACC-1']),
      committedRemovedKeys: new Set(),
      addedRemovedKeys: new Set(),
      currentMemberKeys: new Set(['ACC-1', 'ACC-2']),
      logsByIssue: new Map(),
    };

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([addedIssue, committedIssue]);
    sprintRepo.find.mockResolvedValue([sprint]);
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membership]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', 'added-mid-sprint');

    const keys = result.boards[0].items.map((i) => i.key);
    expect(keys).toContain('ACC-1');
    expect(keys).not.toContain('ACC-2');
  });

  // -------------------------------------------------------------------------
  // Filter: support
  // -------------------------------------------------------------------------

  it('filter=support returns only isSupport=true items', async () => {
    const board = makeBoard({ supportLabels: ['support'] });
    const supportIssue = makeIssue({ key: 'ACC-1', issueType: 'Story', labels: ['support'] });
    const regularIssue = makeIssue({ key: 'ACC-2', issueType: 'Story', labels: [] });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([supportIssue, regularIssue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', 'support');

    const keys = result.boards[0].items.map((i) => i.key);
    expect(keys).toContain('ACC-1');
    expect(keys).not.toContain('ACC-2');
  });

  // -------------------------------------------------------------------------
  // Filter: not-on-roadmap
  // -------------------------------------------------------------------------

  it('filter=not-on-roadmap returns only onRoadmap=false items', async () => {
    const issue = makeIssue({ key: 'ACC-1', issueType: 'Story' });
    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', 'not-on-roadmap');
    // Issue has no roadmap link so onRoadmap=false — should appear
    const keys = result.boards[0].items.map((i) => i.key);
    expect(keys).toContain('ACC-1');
  });

  // -------------------------------------------------------------------------
  // Health score — empty board scores 100
  // -------------------------------------------------------------------------

  it('health score is 100 for an empty board', async () => {
    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].healthScore.overall).toBe(100);
    expect(result.boards[0].healthScore.roadmapAlignmentScore).toBe(100);
    expect(result.boards[0].healthScore.supportBurdenScore).toBe(100);
    expect(result.boards[0].healthScore.stabilityScore).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Health score — support burden
  // -------------------------------------------------------------------------

  it('reduces support burden score when board has support items', async () => {
    const board = makeBoard({ supportLabels: ['support'] });
    const supportIssue = makeIssue({ key: 'ACC-1', issueType: 'Story', labels: ['support'] });
    const regularIssue = makeIssue({ key: 'ACC-2', issueType: 'Story', labels: [] });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([supportIssue, regularIssue]);
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    // 1 of 2 is support: supportBurdenScore = (1 - 0.5) * 100 = 50
    expect(result.boards[0].healthScore.supportBurdenScore).toBe(50);
    expect(result.boards[0].healthScore.overall).toBeLessThan(100);
  });

  // -------------------------------------------------------------------------
  // Totals aggregate across all boards
  // -------------------------------------------------------------------------

  it('aggregates totals across all boards', async () => {
    const board1 = makeBoard({ boardId: 'ACC' });
    const board2 = makeBoard({ boardId: 'BPT' });
    const issue1 = makeIssue({ key: 'ACC-1', issueType: 'Story', boardId: 'ACC' });
    const issue2 = makeIssue({ key: 'BPT-1', issueType: 'Story', boardId: 'BPT' });

    boardConfigRepo.find.mockResolvedValue([board1, board2]);
    issueRepo.find.mockImplementation(({ where }: { where: { boardId: string } }) => {
      if (where.boardId === 'ACC') return Promise.resolve([issue1]);
      if (where.boardId === 'BPT') return Promise.resolve([issue2]);
      return Promise.resolve([]);
    });
    sprintRepo.find.mockResolvedValue([]);
    sprintMembership.reconstructMany.mockResolvedValue(new Map());
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards).toHaveLength(2);
    expect(result.totals.totalItems).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Invalid week format
  // -------------------------------------------------------------------------

  it('throws BadRequestException for invalid week format', async () => {
    boardConfigRepo.find.mockResolvedValue([]);
    await expect(service.getAllItems('invalid', undefined)).rejects.toThrow();
  });
});
