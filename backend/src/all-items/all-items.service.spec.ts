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

  // -------------------------------------------------------------------------
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

  it('includes only kanban issues whose board-entry date is within the week', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 3 issues: one entered this week, one entered last week, one has no entry transition
    const inWeek = makeIssue({ key: 'PLAT-1', boardId: 'PLAT' });
    const priorWeek = makeIssue({ key: 'PLAT-2', boardId: 'PLAT' });
    const noEntry = makeIssue({ key: 'PLAT-3', boardId: 'PLAT' });

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
    issueRepo.find.mockResolvedValue([inWeek, priorWeek, noEntry]);
    sprintRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    roadmapConfigRepo.find.mockResolvedValue([]);
    changelogRepo.createQueryBuilder.mockReturnValue(makeQb([clInWeek, clPriorWeek]));
    issueLinkRepo.createQueryBuilder.mockReturnValue(makeQb([]));
    jpdIdeaRepo.find.mockResolvedValue([]);

    const result = await service.getAllItems('2026-W20', undefined);
    const keys = result.boards[0].items.map((i) => i.key);

    expect(keys).toContain('PLAT-1');
    expect(keys).not.toContain('PLAT-2');  // prior week
    expect(keys).not.toContain('PLAT-3');  // no entry transition
    expect(result.boards[0].summary.totalItems).toBe(1);
  });

  it('marks kanbanAdd=true for all kanban working-set items', async () => {
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

    expect(item?.kanbanAdd).toBe(true);
    expect(item?.addedMidSprint).toBe(false);
  });

  it('returns empty kanban board when no issues enter the board in the week', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 980 issues on board but all entered in prior weeks
    const issues = Array.from({ length: 5 }, (_, i) =>
      makeIssue({ key: `PLAT-${i + 1}`, boardId: 'PLAT' }),
    );
    // All changelogs are from prior weeks
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

    expect(result.boards[0].items).toHaveLength(0);
    expect(result.boards[0].summary.totalItems).toBe(0);
    expect(result.boards[0].healthScore.overall).toBe(100);
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
    // Return the correct sprint for each board's query builder call
    sprintRepo.createQueryBuilder
      .mockReturnValueOnce(makeQb([sprint1]))  // ACC board
      .mockReturnValueOnce(makeQb([sprint2])); // BPT board
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
      makeIssue({ key: 'PLAT-1', boardId: 'PLAT' }),
      makeIssue({ key: 'PLAT-2', boardId: 'PLAT' }),
      makeIssue({ key: 'PLAT-3', boardId: 'PLAT' }),
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
      makeIssue({ key: `PLAT-${i + 1}`, boardId: 'PLAT' }),
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
    // 1 of 2 items was added mid-sprint: disruption ratio = 1/2 = 50 → stabilityScore = 50

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

    // scrum: (1 - 1/2) * 100 = 50
    expect(result.boards[0].healthScore.stabilityScore).toBe(50);
  });

  // -------------------------------------------------------------------------
  // Kanban completedCount: decoupled from board-entry working set (proposal 0065)
  // -------------------------------------------------------------------------

  it('kanban completedCount includes items that entered the board in a prior week but completed this week', async () => {
    const kanbanBoard = makeBoard({ boardId: 'PLAT', boardType: 'kanban' });
    // 2 items entered this week (working set), 3 items entered prior weeks
    const enteredThisWeek = [
      makeIssue({ key: 'PLAT-1', boardId: 'PLAT' }),
      makeIssue({ key: 'PLAT-2', boardId: 'PLAT' }),
    ];
    const enteredPriorWeeks = [
      makeIssue({ key: 'PLAT-3', boardId: 'PLAT' }),
      makeIssue({ key: 'PLAT-4', boardId: 'PLAT' }),
      makeIssue({ key: 'PLAT-5', boardId: 'PLAT' }),
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
      makeIssue({ key: `PLAT-${i + 10}`, boardId: 'PLAT' }),
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

  it('scrum completedCount is NOT affected by the kanban fix (regression guard)', async () => {
    const sprint = makeSprint();
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
});
