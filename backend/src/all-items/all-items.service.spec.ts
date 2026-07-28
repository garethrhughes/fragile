/**
 * Unit tests for AllItemsService
 *
 * NOTE: Bespoke MyPass-only report (feature 0012, proposals 0062/0063).
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
  i.inBacklog = false;
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
  s.startDate = new Date('2026-05-11T00:00:00Z'); // Monday of W20
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

function membershipWith(committed: string[], added: string[] = [], addedAt?: Date): SprintMembership {
  // Build logsByIssue for added keys so the week-window timestamp check passes.
  // Default addedAt falls within 2026-W20 (Mon 11 May – Sun 17 May).
  const addedTimestamp = addedAt ?? new Date('2026-05-13T10:00:00Z')
  const logsByIssue = new Map<string, JiraChangelog[]>()
  for (const key of added) {
    const cl = new JiraChangelog()
    cl.id = Math.random()
    cl.issueKey = key
    cl.field = 'Sprint'
    cl.fromValue = null
    cl.toValue = 'Sprint 1'
    cl.fromId = null
    cl.toId = 'sprint-1'
    cl.changedAt = addedTimestamp
    logsByIssue.set(key, [cl])
  }
  return {
    committedKeys: new Set(committed),
    addedKeys: new Set(added),
    committedRemovedKeys: new Set(),
    addedRemovedKeys: new Set(),
    currentMemberKeys: new Set([...committed, ...added]),
    logsByIssue,
  }
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
  // Scrum: returns empty when no sprints overlap the week
  // -------------------------------------------------------------------------

  it('returns empty scrum board result when no sprints overlap the week', async () => {
    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([makeIssue()]);
    // Sprint query builder returns nothing — no overlap
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].items).toHaveLength(0);
    expect(result.boards[0].summary.totalItems).toBe(0);
  });

  it('does not crash with QueryFailedError when working set is empty and supportLinkTypes is configured', async () => {
    // Regression test: empty working set produced `IN ()` which PostgreSQL rejects.
    // Affects kanban boards during weeks when no issues were pulled in.
    const board = makeBoard({ boardType: 'kanban', supportLinkTypes: ['clones'], triageBoardKey: 'TTB' });
    boardConfigRepo.find.mockResolvedValue([board]);
    // Board has issues but none entered the board this week → kanban workingSet = []
    issueRepo.find.mockResolvedValue([makeIssue({ status: 'In Progress', inBacklog: false } as never)]);
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    // Simulate Postgres rejecting `IN ()` — this is what happened in production
    const emptyInQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockRejectedValue(new Error('syntax error at or near ")"')),
    };
    issueLinkRepo.createQueryBuilder.mockReturnValue(emptyInQb as never);

    // Must resolve without throwing — the guard must prevent issuing `IN ()`
    await expect(service.getAllItems('2026-W11', undefined)).resolves.toBeDefined();
  });
  // Scrum: future sprints are excluded
  // -------------------------------------------------------------------------

  it('excludes future sprints — only active and closed sprints are included', async () => {
    // The query builder mock simulates the DB already filtering by state IN
    // ('active','closed'): the future sprint is never returned.
    // This test verifies that issues belonging only to a future sprint do NOT
    // appear in the working set (i.e. the state filter is applied).
    const activeSprint = makeSprint({ id: 'sprint-active', state: 'active' });
    const activeIssue = makeIssue({ key: 'ACC-1' });
    const futureIssue = makeIssue({ key: 'ACC-2' }); // would be in future sprint

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([activeIssue, futureIssue]);
    // DB returns only the active sprint (future sprint excluded by state filter)
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([activeSprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      // Only ACC-1 is a member of the active sprint; ACC-2 is not
      new Map([['sprint-active', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const keys = result.boards[0].items.map((i) => i.key);

    expect(keys).toContain('ACC-1');
    expect(keys).not.toContain('ACC-2');
    expect(result.boards[0].summary.totalItems).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Scrum: working set is sprint members only, not full backlog
  // -------------------------------------------------------------------------

  it('includes only sprint-member issues for scrum boards, not full backlog', async () => {
    const sprint = makeSprint();
    // 3 issues on board, but only 2 are sprint members
    const sprintIssue1 = makeIssue({ key: 'ACC-1' });
    const sprintIssue2 = makeIssue({ key: 'ACC-2' });
    const backlogIssue = makeIssue({ key: 'ACC-3' });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([sprintIssue1, sprintIssue2, backlogIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1', 'ACC-2'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const keys = result.boards[0].items.map((i) => i.key);

    expect(keys).toContain('ACC-1');
    expect(keys).toContain('ACC-2');
    expect(keys).not.toContain('ACC-3');
    expect(result.boards[0].summary.totalItems).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Scrum: total items matches sprint working set, not board backlog
  // -------------------------------------------------------------------------

  it('totalItems reflects sprint working set size, not full board backlog', async () => {
    const sprint = makeSprint();
    // Board has 10 issues, sprint only has 3
    const boardIssues = Array.from({ length: 10 }, (_, i) =>
      makeIssue({ key: `ACC-${i + 1}` }),
    );
    const sprintKeys = ['ACC-1', 'ACC-2', 'ACC-3'];

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue(boardIssues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(sprintKeys)]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].summary.totalItems).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Excludes epics and subtasks
  // -------------------------------------------------------------------------

  it('excludes epics and subtasks from results', async () => {
    const sprint = makeSprint();
    const epic = makeIssue({ key: 'ACC-0', issueType: 'Epic' });
    const subtask = makeIssue({ key: 'ACC-2', issueType: 'Sub-task' });
    const story = makeIssue({ key: 'ACC-1', issueType: 'Story' });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    // isWorkItem filters happen before sprint membership — all three load but
    // only story passes the filter
    issueRepo.find.mockResolvedValue([epic, subtask, story]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    const keys = result.boards[0].items.map((i) => i.key);
    expect(keys).not.toContain('ACC-0');
    expect(keys).not.toContain('ACC-2');
    expect(keys).toContain('ACC-1');
  });

  // -------------------------------------------------------------------------
  // Scrum: addedMidSprint flag
  // -------------------------------------------------------------------------

  it('marks addedMidSprint=true for issues in addedKeys, false for committedKeys', async () => {
    const sprint = makeSprint();
    const committed = makeIssue({ key: 'ACC-1' });
    const added = makeIssue({ key: 'ACC-2' });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([committed, added]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'], ['ACC-2'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const committedItem = result.boards[0].items.find((i) => i.key === 'ACC-1');
    const addedItem = result.boards[0].items.find((i) => i.key === 'ACC-2');

    expect(committedItem?.addedMidSprint).toBe(false);
    expect(addedItem?.addedMidSprint).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Scrum: deduplicates issues across two overlapping sprints
  // -------------------------------------------------------------------------

  it('deduplicates issues that appear in multiple overlapping sprints', async () => {
    const sprint1 = makeSprint({ id: 'sprint-1', name: 'Sprint 1' });
    const sprint2 = makeSprint({ id: 'sprint-2', name: 'Sprint 2' });
    const issue = makeIssue({ key: 'ACC-1' });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint1, sprint2]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([
        ['sprint-1', membershipWith(['ACC-1'])],
        ['sprint-2', membershipWith(['ACC-1'])],
      ]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // Should appear exactly once
    const keys = result.boards[0].items.map((i) => i.key);
    expect(keys.filter((k) => k === 'ACC-1')).toHaveLength(1);
    expect(result.boards[0].summary.totalItems).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Scrum: started flag
  // -------------------------------------------------------------------------

  it('marks started=true when first in-progress transition occurs within the week', async () => {
    const sprint = makeSprint();
    const issue = makeIssue({ key: 'ACC-1', status: 'In Progress' });
    const cl = makeChangelog({
      issueKey: 'ACC-1',
      field: 'status',
      fromValue: 'To Do',
      toValue: 'In Progress',
      changedAt: new Date('2026-05-12T09:00:00Z'), // 2026-W20
    });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.started).toBe(true);
  });

  it('marks started=false when in-progress transition is before the week', async () => {
    const sprint = makeSprint();
    const issue = makeIssue({ key: 'ACC-1', status: 'In Progress' });
    const cl = makeChangelog({
      issueKey: 'ACC-1',
      field: 'status',
      fromValue: 'To Do',
      toValue: 'In Progress',
      changedAt: new Date('2026-05-04T09:00:00Z'), // 2026-W19
    });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.started).toBe(false);
  });

  it('marks started=false for committed sprint issue with no changelog activity in the week', async () => {
    const sprint = makeSprint();
    const issue = makeIssue({ key: 'ACC-1', status: 'To Do' });
    // No changelogs at all

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    // Issue is in the working set (committed) but has no activity — counts in
    // totalItems but not in startedCount or completedCount
    expect(item).toBeDefined();
    expect(item?.started).toBe(false);
    expect(item?.completed).toBe(false);
    expect(result.boards[0].summary.totalItems).toBe(1);
    expect(result.boards[0].summary.startedCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Scrum: completed flag
  // -------------------------------------------------------------------------

  it('marks completed=true when done transition occurs within the week', async () => {
    const sprint = makeSprint();
    const issue = makeIssue({ key: 'ACC-1', status: 'Done' });
    const cl = makeChangelog({
      issueKey: 'ACC-1',
      field: 'status',
      fromValue: 'In Progress',
      toValue: 'Done',
      changedAt: new Date('2026-05-13T14:00:00Z'), // 2026-W20
    });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'ACC-1');

    expect(item?.completed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Kanban: working set is board-entry-in-week only
  // -------------------------------------------------------------------------

  it('includes only kanban issues whose board-entry date is within the week in working set (totalItems)', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 3 issues: one entered this week, one entered last week, one is in the backlog
    const inWeek = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'To Do' });
    const priorWeek = makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'To Do' });
    const inBacklog = makeIssue({ key: 'PLAT-3', boardId: 'PLAT', status: 'To Do', inBacklog: true } as Parameters<typeof makeIssue>[0]);

    const clInWeek = makeChangelog({
      issueKey: 'PLAT-1',
      field: 'status',
      fromValue: null,
      toValue: 'To Do',
      changedAt: new Date('2026-05-12T08:00:00Z'), // W20
    });
    const clPriorWeek = makeChangelog({
      issueKey: 'PLAT-2',
      field: 'status',
      fromValue: null,
      toValue: 'To Do',
      changedAt: new Date('2026-05-05T08:00:00Z'), // W19
    });

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([inWeek, priorWeek, inBacklog]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([clInWeek, clPriorWeek]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // totalItems (working set) = 1 — only PLAT-1 entered this week
    expect(result.boards[0].summary.totalItems).toBe(1);
    // PLAT-1 is in working set
    const plat1 = result.boards[0].items.find((i) => i.key === 'PLAT-1');
    expect(plat1).toBeDefined();
    expect(plat1?.started).toBe(true);
    // PLAT-2 appears as in-flight (entered prior week, still To Do, not in backlog)
    const plat2 = result.boards[0].items.find((i) => i.key === 'PLAT-2');
    expect(plat2).toBeDefined();
    expect(plat2?.inFlight).toBe(true);
    // PLAT-3 has inBacklog=true — excluded from all metrics and item list
    const plat3 = result.boards[0].items.find((i) => i.key === 'PLAT-3');
    expect(plat3).toBeUndefined();
  });

  it('marks kanbanAdd=false for all kanban working-set items (mid-week concept removed for kanban)', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const issue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT' });
    const cl = makeChangelog({
      issueKey: 'PLAT-1',
      field: 'status',
      fromValue: null,
      toValue: 'To Do',
      changedAt: new Date('2026-05-12T08:00:00Z'), // W20
    });

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([cl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const item = result.boards[0].items.find((i) => i.key === 'PLAT-1');

    expect(item?.kanbanAdd).toBe(false);
    expect(item?.addedMidSprint).toBe(false);
  });

  it('kanban board with no issues entering this week shows in-flight issues from prior weeks', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 5 issues on board, all entered in prior weeks, all currently in-progress (in-flight)
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `PLAT-${i + 1}`, boardId: 'PLAT', status: 'In Progress' }),
    );
    const priorCls = issues.map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        toValue: 'To Do',
        changedAt: new Date('2026-04-01T08:00:00Z'), // well before W20
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue(issues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb(priorCls));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // totalItems = 0 (nothing entered this week)
    expect(result.boards[0].summary.totalItems).toBe(0);
    // inFlightCount = 5 (all 5 are in-progress, not done)
    expect(result.boards[0].summary.inFlightCount).toBe(5);
    // items list shows the 5 in-flight issues
    expect(result.boards[0].items).toHaveLength(5);
    expect(result.boards[0].items.every((i) => i.inFlight)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Support detection
  // -------------------------------------------------------------------------

  it('marks isSupport=true when issue has a support label', async () => {
    const sprint = makeSprint();
    const board = makeBoard({ supportLabels: ['support'] });
    const issue = makeIssue({ key: 'ACC-1', labels: ['support'] });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    expect(result.boards[0].items[0]?.isSupport).toBe(true);
  });

  it('marks isTtbSupport=true when issue has a TTB triage link', async () => {
    const sprint = makeSprint();
    const board = makeBoard({ supportLinkTypes: ['clones'], triageBoardKey: 'TTB' });
    const issue = makeIssue({ key: 'ACC-1' });
    const link = Object.assign(new JiraIssueLink(), {
      id: 1,
      sourceIssueKey: 'ACC-1',
      targetIssueKey: 'TTB-42',
      linkTypeName: 'clones',
    });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
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

  it('filter=added-mid-sprint returns only addedMidSprint items', async () => {
    const sprint = makeSprint();
    const addedIssue = makeIssue({ key: 'ACC-1' });
    const committedIssue = makeIssue({ key: 'ACC-2' });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([addedIssue, committedIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-2'], ['ACC-1'])]]),
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
    const sprint = makeSprint();
    const board = makeBoard({ supportLabels: ['support'] });
    const supportIssue = makeIssue({ key: 'ACC-1', labels: ['support'] });
    const regularIssue = makeIssue({ key: 'ACC-2', labels: [] });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([supportIssue, regularIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1', 'ACC-2'])]]),
    );
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
    const sprint = makeSprint();
    const issue = makeIssue({ key: 'ACC-1' });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', 'not-on-roadmap');
    // Issue has no roadmap link so onRoadmap=false — should appear
    expect(result.boards[0].items.map((i) => i.key)).toContain('ACC-1');
  });

  // -------------------------------------------------------------------------
  // Health score
  // -------------------------------------------------------------------------

  it('health score is 100 for an empty board', async () => {
    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].healthScore.overall).toBe(100);
  });

  it('reduces support burden score when board has support items', async () => {
    const sprint = makeSprint();
    const board = makeBoard({ supportLabels: ['support'] });
    const supportIssue = makeIssue({ key: 'ACC-1', labels: ['support'] });
    const regularIssue = makeIssue({ key: 'ACC-2', labels: [] });

    boardConfigRepo.find.mockResolvedValue([board]);
    issueRepo.find.mockResolvedValue([supportIssue, regularIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1', 'ACC-2'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    // 1 of 2 is support: supportBurdenScore = (1 - 0.5) * 100 = 50
    expect(result.boards[0].healthScore.supportBurdenScore).toBe(50);
    // overall is now roadmap + stability only — support no longer penalises the score
    // no completions → roadmapAlignmentScore=100; no mid-sprint adds → stabilityScore=100
    expect(result.boards[0].healthScore.overall).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Totals aggregate across all boards
  // -------------------------------------------------------------------------

  it('aggregates totals across all boards', async () => {
    const board1 = makeBoard({ boardId: 'ACC', boardType: 'scrum' });
    const board2 = makeBoard({ boardId: 'BPT', boardType: 'scrum' });
    const sprint1 = makeSprint({ id: 'sprint-acc', boardId: 'ACC' });
    const sprint2 = makeSprint({ id: 'sprint-bpt', boardId: 'BPT' });
    const issue1 = makeIssue({ key: 'ACC-1', boardId: 'ACC' });
    const issue2 = makeIssue({ key: 'BPT-1', boardId: 'BPT' });

    boardConfigRepo.find.mockResolvedValue([board1, board2]);
    issueRepo.find.mockImplementation(({ where }: { where: { boardId: string } }) => {
      if (where.boardId === 'ACC') return Promise.resolve([issue1]);
      if (where.boardId === 'BPT') return Promise.resolve([issue2]);
      return Promise.resolve([]);
    });
    // Return sprints for every query-builder call. Uses an implementation
    // (not mockReturnValueOnce) because the Health Check computes prior weeks,
    // calling this more than twice. reconstructMany is boardId-keyed, so
    // returning both sprints is safe — only the matching member is included.
    sprintRepo.createQueryBuilder.mockImplementation(() => makeQb([sprint1, sprint2]));
    sprintMembership.reconstructMany.mockImplementation(
      ({ sprints }: { sprints: JiraSprint[] }) => {
        const m = new Map<string, SprintMembership>();
        for (const s of sprints) {
          if (s.id === 'sprint-acc') m.set('sprint-acc', membershipWith(['ACC-1']));
          if (s.id === 'sprint-bpt') m.set('sprint-bpt', membershipWith(['BPT-1']));
        }
        return Promise.resolve(m);
      },
    );
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

  // -------------------------------------------------------------------------
  // Kanban stability: throughput balance (ADR 0062)
  // -------------------------------------------------------------------------

  it('kanban stability is 100 when completed count equals entered count (balanced throughput)', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 3 issues enter the board this week; 3 are completed this week
    const issues = [
      makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'Done' }),
      makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'Done' }),
      makeIssue({ key: 'PLAT-3', boardId: 'PLAT', status: 'Done' }),
    ];
    const entryChangelogs = issues.map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20 board-entry
      }),
    );
    const doneChangelogs = issues.map((iss, i) =>
      makeChangelog({
        id: i + 10,
        issueKey: iss.key,
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-05-14T15:00:00Z'), // W20 completion
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue(issues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([...entryChangelogs, ...doneChangelogs]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].healthScore.stabilityScore).toBe(100);
  });

  it('kanban stability is 60 when 3 of 5 entered items are completed (under-delivery)', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 5 issues enter; only 3 are done within the week
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `PLAT-${i + 1}`, boardId: 'PLAT', status: i < 3 ? 'Done' : 'In Progress' }),
    );
    const entryChangelogs = issues.map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20 board-entry
      }),
    );
    // Only first 3 are completed this week
    const doneChangelogs = issues.slice(0, 3).map((iss, i) =>
      makeChangelog({
        id: i + 10,
        issueKey: iss.key,
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-05-14T15:00:00Z'), // W20 completion
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue(issues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([...entryChangelogs, ...doneChangelogs]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // 3 completed / 5 entered = 60%
    expect(result.boards[0].healthScore.stabilityScore).toBe(60);
  });

  it('kanban stability is 100 (capped) when more items are completed than entered (over-delivery)', async () => {
    // This can happen when items entered in a prior week are completed this week,
    // but the board working set only contains items that entered THIS week.
    // In practice this means completedCount can't exceed totalItems, but we
    // test the cap anyway to confirm Math.min is applied.
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const issues = [
      makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'Done' }),
      makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'Done' }),
    ];
    const entryChangelogs = issues.map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20 board-entry
      }),
    );
    const doneChangelogs = issues.map((iss, i) =>
      makeChangelog({
        id: i + 10,
        issueKey: iss.key,
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-05-14T15:00:00Z'), // W20 completion
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue(issues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([...entryChangelogs, ...doneChangelogs]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].healthScore.stabilityScore).toBe(100);
  });

  it('kanban stability is 0 when no entered items are completed this week', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const issues = [
      makeIssue({ key: 'PLAT-1', boardId: 'PLAT' }),
      makeIssue({ key: 'PLAT-2', boardId: 'PLAT' }),
    ];
    const entryChangelogs = issues.map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20 board-entry
      }),
    );
    // No done changelogs this week

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue(issues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb(entryChangelogs));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // 0 completed / 2 entered = 0%
    expect(result.boards[0].healthScore.stabilityScore).toBe(0);
  });

  it('scrum stability is unaffected by the kanban throughput formula (regression guard)', async () => {
    const sprint = makeSprint();
    const committed = makeIssue({ key: 'ACC-1' });
    const added = makeIssue({ key: 'ACC-2' });
    // 1 committed + 1 added: stability = 1 / (1 + 1) * 100 = 50

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([committed, added]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1'], ['ACC-2'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // scrum: committed / (committed + added) = 1 / 2 = 50%
    expect(result.boards[0].healthScore.stabilityScore).toBe(50);
  });

  it('scrum stability uses sprint-lifetime committed/added ratio across overlapping sprints', async () => {
    // Sprint A: 8 committed + 2 added = 10 items
    // Sprint B: 5 committed + 0 added = 5 items
    // Pooled: 13 committed / 15 total = 87% stability
    const sprintA = makeSprint({ id: 'sprint-a', name: 'Sprint A' });
    const sprintB = makeSprint({ id: 'sprint-b', name: 'Sprint B' });

    const issues = [
      ...Array.from({ length: 8 }, (_, i) => makeIssue({ key: `ACC-${i + 1}` })),
      makeIssue({ key: 'ACC-9' }),
      makeIssue({ key: 'ACC-10' }),
      ...Array.from({ length: 5 }, (_, i) => makeIssue({ key: `ACC-${i + 11}` })),
    ];

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue(issues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprintA, sprintB]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([
        ['sprint-a', membershipWith(
          ['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4', 'ACC-5', 'ACC-6', 'ACC-7', 'ACC-8'],
          ['ACC-9', 'ACC-10'],
        )],
        ['sprint-b', membershipWith(
          ['ACC-11', 'ACC-12', 'ACC-13', 'ACC-14', 'ACC-15'],
          [],
        )],
      ]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // Pooled: 13 / (13 + 2) = 87%
    expect(result.boards[0].healthScore.stabilityScore).toBe(87);
  });

  // -------------------------------------------------------------------------
  // Kanban completedCount: decoupled from board-entry working set (proposal 0065)
  // -------------------------------------------------------------------------

  it('kanban completedCount includes items that entered the board in a prior week but completed this week', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 2 items entered this week (working set), 3 items entered prior weeks
    const enteredThisWeek = [
      makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'Done' }),
      makeIssue({ key: 'PLAT-2', boardId: 'PLAT' }),
    ];
    const enteredPriorWeeks = [
      makeIssue({ key: 'PLAT-3', boardId: 'PLAT', status: 'Done' }),
      makeIssue({ key: 'PLAT-4', boardId: 'PLAT', status: 'Done' }),
      makeIssue({ key: 'PLAT-5', boardId: 'PLAT', status: 'Done' }),
    ];
    const allIssues = [...enteredThisWeek, ...enteredPriorWeeks];

    // Board-entry changelogs: PLAT-1 & PLAT-2 entered this week; PLAT-3/4/5 entered prior week
    const entryThisWeekCls = enteredThisWeek.map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20
      }),
    );
    const entryPriorWeekCls = enteredPriorWeeks.map((iss, i) =>
      makeChangelog({
        id: i + 10,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-01T08:00:00Z'), // W18 — prior week
      }),
    );

    // Done changelogs: PLAT-1, PLAT-3, PLAT-4, PLAT-5 all complete this week
    // (PLAT-2 is NOT completed)
    const doneCls = ['PLAT-1', 'PLAT-3', 'PLAT-4', 'PLAT-5'].map((key, i) =>
      makeChangelog({
        id: i + 20,
        issueKey: key,
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-05-14T15:00:00Z'), // W20 completion
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue(allIssues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(
      makeQb([...entryThisWeekCls, ...entryPriorWeekCls, ...doneCls]),
    );
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // totalItems = 2 (only those that entered this week)
    expect(result.boards[0].summary.totalItems).toBe(2);
    // completedCount = 4 (all items that completed this week, regardless of entry date)
    expect(result.boards[0].summary.completedCount).toBe(4);
  });

  it('kanban stabilityScore uses board-wide completedCount as numerator', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 5 items entered this week, 3 items from prior weeks also completed this week
    const enteredThisWeek = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `PLAT-${i + 1}`, boardId: 'PLAT' }),
    );
    const fromPriorWeek = Array.from({ length: 3 }, (_, i) =>
      makeIssue({ key: `PLAT-${i + 10}`, boardId: 'PLAT', status: 'Done' }),
    );
    const allIssues = [...enteredThisWeek, ...fromPriorWeek];

    const entryThisWeekCls = enteredThisWeek.map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20
      }),
    );
    const entryPriorCls = fromPriorWeek.map((iss, i) =>
      makeChangelog({
        id: i + 20,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-04-28T08:00:00Z'), // prior week
      }),
    );

    // 3 items from prior weeks complete this week (PLAT-10, PLAT-11, PLAT-12)
    const doneCls = fromPriorWeek.map((iss, i) =>
      makeChangelog({
        id: i + 30,
        issueKey: iss.key,
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-05-13T15:00:00Z'), // W20 completion
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue(allIssues);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(
      makeQb([...entryThisWeekCls, ...entryPriorCls, ...doneCls]),
    );
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // totalItems = 5 (entered this week), completedCount = 3 (done this week board-wide)
    expect(result.boards[0].summary.totalItems).toBe(5);
    expect(result.boards[0].summary.completedCount).toBe(3);
    // stabilityScore = min(3/5, 1) * 100 = 60
    expect(result.boards[0].healthScore.stabilityScore).toBe(60);
  });

  it('scrum completedCount is NOT affected by the kanban fix (regression guard)', async () => {    const sprint = makeSprint();
    // 2 committed issues, 1 completes this week
    const issue1 = makeIssue({ key: 'ACC-1' });
    const issue2 = makeIssue({ key: 'ACC-2' });
    const doneCl = makeChangelog({
      issueKey: 'ACC-1',
      field: 'status',
      fromValue: 'In Progress',
      toValue: 'Done',
      changedAt: new Date('2026-05-13T14:00:00Z'), // W20
    });

    boardConfigRepo.find.mockResolvedValue([makeBoard()]);
    issueRepo.find.mockResolvedValue([issue1, issue2]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([sprint]));
    sprintMembership.reconstructMany.mockResolvedValue(
      new Map([['sprint-1', membershipWith(['ACC-1', 'ACC-2'])]]),
    );
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([doneCl]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // Only 1 issue completed within the sprint working set
    expect(result.boards[0].summary.completedCount).toBe(1);
    expect(result.boards[0].summary.totalItems).toBe(2);
  });

  it('kanban completedCount excludes cancelled issues even if they transitioned through Done', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 2 items entered this week; 1 extra issue entered a prior week
    const enteredThisWeek1 = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'Done' });
    const enteredThisWeek2 = makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'Done' });
    // This issue was moved to Done then Cancelled — should NOT be counted
    const cancelledIssue = makeIssue({ key: 'PLAT-3', boardId: 'PLAT', status: 'Cancelled' });

    const entryThisWeekCls = [enteredThisWeek1, enteredThisWeek2].map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20 board-entry
      }),
    );
    const entryPriorCl = makeChangelog({
      id: 10,
      issueKey: 'PLAT-3',
      field: 'status',
      fromValue: null,
      toValue: 'To Do',
      changedAt: new Date('2026-05-01T08:00:00Z'), // prior week
    });

    // All 3 transitioned through Done this week (simulating Jira workflow Done → Cancelled)
    const doneCls = [enteredThisWeek1, enteredThisWeek2, cancelledIssue].map((iss, i) =>
      makeChangelog({
        id: i + 20,
        issueKey: iss.key,
        field: 'status',
        fromValue: 'In Progress',
        toValue: 'Done',
        changedAt: new Date('2026-05-14T10:00:00Z'), // W20
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([enteredThisWeek1, enteredThisWeek2, cancelledIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(
      makeQb([...entryThisWeekCls, entryPriorCl, ...doneCls]),
    );
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // totalItems = 2 (entered this week, excluding cancelled)
    // completedCount = 2 (PLAT-1 and PLAT-2 only — PLAT-3 cancelled, excluded)
    expect(result.boards[0].summary.completedCount).toBe(2);
    expect(result.boards[0].summary.totalItems).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Proposal 0066 — Align kanban pulse with week-detail
  // -------------------------------------------------------------------------

  // 1. boardEntryStatuses — 7-entry default
  it('kanban working set detects board entry via Backlog status when boardEntryStatuses uses default 7-entry list', async () => {
    // Issue enters via 'Backlog' (not 'To Do') — invisible with old 1-entry fallback
    // boardEntryStatuses is null to trigger the 7-entry default
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban', boardEntryStatuses: null as unknown as string[] });
    const issue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT' });

    const entryViaBacklog = makeChangelog({
      id: 1,
      issueKey: 'PLAT-1',
      field: 'status',
      fromValue: null,
      toValue: 'Backlog', // NOT 'To Do'
      changedAt: new Date('2026-05-12T08:00:00Z'), // W20
    });

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([issue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([entryViaBacklog]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // With 7-entry default, 'Backlog' is a valid board-entry status
    expect(result.boards[0].summary.totalItems).toBe(1);
    expect(result.boards[0].items[0].key).toBe('PLAT-1');
  });

  // 2. inBacklog — working set
  it('kanban working set excludes issues where inBacklog=true', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const activeIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'To Do', inBacklog: false } as Parameters<typeof makeIssue>[0]);
    const backlogIssue = makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'To Do', inBacklog: true } as Parameters<typeof makeIssue>[0]);

    const entryCls = [activeIssue, backlogIssue].map((iss, i) =>
      makeChangelog({
        id: i + 1,
        issueKey: iss.key,
        field: 'status',
        fromValue: null,
        toValue: 'To Do',
        changedAt: new Date('2026-05-12T08:00:00Z'), // W20
      }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([activeIssue, backlogIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb(entryCls));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].summary.totalItems).toBe(1);
    expect(result.boards[0].items[0].key).toBe('PLAT-1');
  });

  // 3. inBacklog — completion scan
  it('kanban completedCount excludes issues where inBacklog=true', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const activeIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'Done', inBacklog: false } as Parameters<typeof makeIssue>[0]);
    const backlogIssue = makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'Done', inBacklog: true } as Parameters<typeof makeIssue>[0]);

    // Both have board-entry this week
    const entryCls = [activeIssue, backlogIssue].map((iss, i) =>
      makeChangelog({ id: i + 1, issueKey: iss.key, field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') }),
    );
    // Both complete this week
    const doneCls = [activeIssue, backlogIssue].map((iss, i) =>
      makeChangelog({ id: i + 10, issueKey: iss.key, field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-05-14T10:00:00Z') }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([activeIssue, backlogIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([...entryCls, ...doneCls]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].summary.completedCount).toBe(1);
  });

  // 4. dataStartDate — working set
  it('kanban working set excludes issues whose board-entry date is before dataStartDate', async () => {
    const kanbanBoard = makeBoard({
      boardId: 'PLAT',
      boardType: 'kanban',
      dataStartDate: '2025-01-01',
    });
    const newIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'To Do' });
    const oldIssue = makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'To Do' });

    // PLAT-1 enters in W20 2026 (after dataStartDate)
    // PLAT-2 enters in W20 2026 BUT its first-ever board-entry was in 2024 (before dataStartDate)
    const plat1Entry = makeChangelog({ id: 1, issueKey: 'PLAT-1', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') });
    const plat2OldEntry = makeChangelog({ id: 2, issueKey: 'PLAT-2', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2024-01-10T08:00:00Z') }); // before dataStartDate

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([newIssue, oldIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([plat1Entry, plat2OldEntry]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].summary.totalItems).toBe(1);
    expect(result.boards[0].items[0].key).toBe('PLAT-1');
  });

  // 5. dataStartDate — completion scan
  it('kanban completedCount excludes issues whose board-entry date is before dataStartDate', async () => {
    const kanbanBoard = makeBoard({
      boardId: 'PLAT',
      boardType: 'kanban',
      dataStartDate: '2025-01-01',
    });
    const newIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'Done' });
    const oldIssue = makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'Done' });

    const newEntry = makeChangelog({ id: 1, issueKey: 'PLAT-1', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2025-06-01T08:00:00Z') }); // after dataStartDate
    const oldEntry = makeChangelog({ id: 2, issueKey: 'PLAT-2', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2024-01-10T08:00:00Z') }); // before dataStartDate
    const doneCls = [newIssue, oldIssue].map((iss, i) =>
      makeChangelog({ id: i + 10, issueKey: iss.key, field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-05-14T10:00:00Z') }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([newIssue, oldIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([newEntry, oldEntry, ...doneCls]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].summary.completedCount).toBe(1);
  });

  // 6. kanbanAdd is always false for kanban (mid-week concept removed)
  it('kanbanAdd is false for kanban issues entering on Monday', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const mondayIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT' });

    const mondayEntry = makeChangelog({
      id: 1, issueKey: 'PLAT-1', field: 'status', fromValue: null, toValue: 'To Do',
      changedAt: new Date('2026-05-11T09:00:00Z'), // Monday
    });

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([mondayIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([mondayEntry]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    const item = result.boards[0].items[0];
    expect(item.kanbanAdd).toBe(false);
  });

  // 7. kanbanAdd is always false for kanban issues entering on Tuesday+
  it('kanbanAdd is false for kanban issues entering on Tuesday (mid-week concept removed)', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const tuesdayIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT' });

    const tuesdayEntry = makeChangelog({
      id: 1, issueKey: 'PLAT-1', field: 'status', fromValue: null, toValue: 'To Do',
      changedAt: new Date('2026-05-12T09:00:00Z'), // Tuesday
    });

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([tuesdayIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([tuesdayEntry]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].items[0].kanbanAdd).toBe(false);
  });

  // 8. addedMidSprintCount is always 0 for kanban boards
  it('kanban addedMidSprintCount is 0 regardless of when issues entered', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const mondayIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT' });
    const tuesdayIssue = makeIssue({ key: 'PLAT-2', boardId: 'PLAT' });
    const wednesdayIssue = makeIssue({ key: 'PLAT-3', boardId: 'PLAT' });

    const cls = [
      makeChangelog({ id: 1, issueKey: 'PLAT-1', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-05-11T08:00:00Z') }), // Mon
      makeChangelog({ id: 2, issueKey: 'PLAT-2', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') }), // Tue
      makeChangelog({ id: 3, issueKey: 'PLAT-3', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-05-13T08:00:00Z') }), // Wed
    ];

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([mondayIssue, tuesdayIssue, wednesdayIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb(cls));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    expect(result.boards[0].summary.totalItems).toBe(3);
    expect(result.boards[0].summary.addedMidSprintCount).toBe(0);
  });

  // 9. Expanded item list — completed-from-prior-week issues appear in items
  it('kanban item list includes issues that completed this week from prior weeks', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // PLAT-1 entered this week (in working set)
    // PLAT-2 entered a prior week, completes this week (should appear in list)
    const inWeekIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'To Do' });
    const priorWeekIssue = makeIssue({ key: 'PLAT-2', boardId: 'PLAT', status: 'Done' });

    const cls = [
      makeChangelog({ id: 1, issueKey: 'PLAT-1', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') }), // W20 entry
      makeChangelog({ id: 2, issueKey: 'PLAT-2', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-04-01T08:00:00Z') }), // prior week entry
      makeChangelog({ id: 3, issueKey: 'PLAT-2', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-05-14T10:00:00Z') }), // W20 completion
    ];

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([inWeekIssue, priorWeekIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb(cls));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    const keys = result.boards[0].items.map((i) => i.key);
    expect(keys).toContain('PLAT-1'); // entered this week
    expect(keys).toContain('PLAT-2'); // completed this week from prior week
  });

  // 10. Prior-week completer has correct flags
  it('kanban prior-week completer has started=false, kanbanAdd=false, completed=true', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    const priorWeekIssue = makeIssue({ key: 'PLAT-1', boardId: 'PLAT', status: 'Done' });

    const cls = [
      makeChangelog({ id: 1, issueKey: 'PLAT-1', field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-04-01T08:00:00Z') }), // prior entry
      makeChangelog({ id: 2, issueKey: 'PLAT-1', field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-05-14T10:00:00Z') }), // W20 done
    ];

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([priorWeekIssue]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb(cls));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // totalItems = 0 (none entered this week), but item list has 1 item
    expect(result.boards[0].summary.totalItems).toBe(0);
    expect(result.boards[0].items).toHaveLength(1);
    const item = result.boards[0].items[0];
    expect(item.started).toBe(false);
    expect(item.kanbanAdd).toBe(false);
    expect(item.completed).toBe(true);
  });

  // 11. totalItems does NOT include prior-week completers (regression guard for buildSummary call order)
  it('kanban totalItems equals working-set size only, not working-set + prior-week completers', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 2 issues entered this week, 5 entered prior weeks and complete this week
    const enteredThisWeek = Array.from({ length: 2 }, (_, i) =>
      makeIssue({ key: `PLAT-${i + 1}`, boardId: 'PLAT', status: 'To Do' }),
    );
    const priorWeekCompleters = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `PLAT-${i + 10}`, boardId: 'PLAT', status: 'Done' }),
    );

    const thisWeekEntryCls = enteredThisWeek.map((iss, i) =>
      makeChangelog({ id: i + 1, issueKey: iss.key, field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') }),
    );
    const priorEntryCls = priorWeekCompleters.map((iss, i) =>
      makeChangelog({ id: i + 10, issueKey: iss.key, field: 'status', fromValue: null, toValue: 'To Do', changedAt: new Date('2026-04-01T08:00:00Z') }),
    );
    const doneCls = priorWeekCompleters.map((iss, i) =>
      makeChangelog({ id: i + 20, issueKey: iss.key, field: 'status', fromValue: 'In Progress', toValue: 'Done', changedAt: new Date('2026-05-14T10:00:00Z') }),
    );

    boardConfigRepo.find.mockResolvedValue([kanbanBoard]);
    issueRepo.find.mockResolvedValue([...enteredThisWeek, ...priorWeekCompleters]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([...thisWeekEntryCls, ...priorEntryCls, ...doneCls]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);

    // summary.totalItems must be 2 (working set only), not 7 (working set + completers)
    expect(result.boards[0].summary.totalItems).toBe(2);
    expect(result.boards[0].summary.addedMidSprintCount).toBe(0);
    // item list has 2 + 5 = 7 items
    expect(result.boards[0].items).toHaveLength(7);
    // completedCount = 5 (board-wide)
    expect(result.boards[0].summary.completedCount).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Health Check (feature 0014, proposal 0071)
  // -------------------------------------------------------------------------

  describe('healthCheck (proposal 0071)', () => {
    /** Compute the current ISO week the same way the service does (UTC in tests). */
    function currentWeekKey(): string {
      const d = new Date();
      const dow = d.getUTCDay();
      const daysToThursday = dow === 0 ? -3 : 4 - dow;
      const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      thursday.setUTCDate(thursday.getUTCDate() + daysToThursday);
      const isoYear = thursday.getUTCFullYear();
      const jan4 = new Date(Date.UTC(isoYear, 0, 4));
      const jan4Dow = jan4.getUTCDay();
      const jan4ToMonday = jan4Dow === 0 ? -6 : 1 - jan4Dow;
      const week1Monday = new Date(jan4);
      week1Monday.setUTCDate(jan4.getUTCDate() + jan4ToMonday);
      const thisMonday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dateToMonday = dow === 0 ? -6 : 1 - dow;
      thisMonday.setUTCDate(thisMonday.getUTCDate() + dateToMonday);
      const weekNum = Math.round((thisMonday.getTime() - week1Monday.getTime()) / (7 * 86_400_000)) + 1;
      return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
    }

    function setupSingleScrumBoard(committed: string[], added: string[] = []) {
      const board = makeBoard({ boardId: 'ACC', boardType: 'scrum' });
      const issues = [...committed, ...added].map((key) => makeIssue({ key, boardId: 'ACC' }));
      boardConfigRepo.find.mockResolvedValue([board]);
      issueRepo.find.mockResolvedValue(issues);
      sprintRepo.createQueryBuilder.mockImplementation(() => makeQb([makeSprint({ id: 'sprint-acc', boardId: 'ACC' })]));
      sprintMembership.reconstructMany.mockResolvedValue(
        new Map([['sprint-acc', membershipWith(committed, added)]]),
      );
      roadmapConfigRepo.find.mockResolvedValue([]);
      changelogRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      jpdIdeaRepo.find.mockResolvedValue([]);
    }

    it('populates healthCheck for a completed (past) week', async () => {
      setupSingleScrumBoard(['ACC-1', 'ACC-2']);

      const result = await service.getAllItems('2026-W20', undefined);

      expect(result.healthCheck).toBeDefined();
      expect(result.healthCheck?.boards).toHaveLength(1);
      expect(result.healthCheck?.boards[0].boardId).toBe('ACC');
    });

    it('omits healthCheck for the current in-progress week', async () => {
      setupSingleScrumBoard(['ACC-1', 'ACC-2']);

      const result = await service.getAllItems(currentWeekKey(), undefined);

      expect(result.healthCheck).toBeUndefined();
    });

    it('exposes scrum volume (committed, added, completed) beside the stability score', async () => {
      setupSingleScrumBoard(['ACC-1', 'ACC-2', 'ACC-3'], ['ACC-4']);

      const result = await service.getAllItems('2026-W20', undefined);
      const board = result.healthCheck?.boards[0];

      expect(board?.volume).toEqual({
        boardType: 'scrum',
        committed: 3,
        added: 1,
        completed: 0,
        onRoadmap: 0,
        support: 0,
      });
      // stability = committed / (committed + added) = 3/4 = 75 -> watch
      expect(board?.stabilityScore).toBe(75);
      expect(board?.stabilityBand).toBe('watch');
    });

    it('reports roadmapScore/roadmapBand as null when nothing was completed', async () => {
      setupSingleScrumBoard(['ACC-1']);

      const result = await service.getAllItems('2026-W20', undefined);
      const board = result.healthCheck?.boards[0];

      expect(board?.roadmapScore).toBeNull();
      expect(board?.roadmapBand).toBeNull();
    });

    it('includes a 4-week trend (selected week + prior 3), oldest first', async () => {
      setupSingleScrumBoard(['ACC-1', 'ACC-2']);

      const result = await service.getAllItems('2026-W20', undefined);
      const trend = result.healthCheck?.boards[0].trend ?? [];

      expect(trend).toHaveLength(4);
      expect(trend.map((t) => t.week)).toEqual([
        '2026-W17',
        '2026-W18',
        '2026-W19',
        '2026-W20',
      ]);
    });

    it('counts a null-roadmap board only toward the roadmap distribution na bucket', async () => {
      setupSingleScrumBoard(['ACC-1', 'ACC-2']); // nothing completed -> roadmap null

      const result = await service.getAllItems('2026-W20', undefined);

      expect(result.healthCheck?.roadmapDistribution.na).toBe(1);
      expect(result.healthCheck?.roadmapDistribution.healthy).toBe(0);
      expect(result.healthCheck?.roadmapDistribution.watch).toBe(0);
      expect(result.healthCheck?.roadmapDistribution.atRisk).toBe(0);
      // stability distribution always classifies (never na): 100% committed -> healthy
      expect(result.healthCheck?.stabilityDistribution.healthy).toBe(1);
    });
  });
});
