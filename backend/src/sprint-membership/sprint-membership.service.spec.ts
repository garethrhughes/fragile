import { Repository } from 'typeorm';
import {
  SprintMembershipService,
  sprintIdContains,
  sprintValueContains,
  wasInSprintAtDate,
  isCarryOverFromSprint,
} from './sprint-membership.service.js';
import {
  JiraSprint,
  JiraIssue,
  JiraIssueSprint,
  JiraChangelog,
} from '../database/entities/index.js';

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

function makeIssue(partial: Partial<JiraIssue>): JiraIssue {
  return {
    key: 'X-1',
    boardId: 'ACC',
    summary: '',
    status: 'To Do',
    issueType: 'Story',
    points: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...partial,
  } as JiraIssue;
}

function makeChangelog(partial: Partial<JiraChangelog>): JiraChangelog {
  return {
    id: 1,
    issueKey: 'X-1',
    field: 'Sprint',
    fromValue: null,
    toValue: null,
    fromId: null,
    toId: null,
    changedAt: new Date('2025-01-01'),
    ...partial,
  } as JiraChangelog;
}

const sprint: JiraSprint = {
  id: '3941',
  boardId: 'ACC',
  name: 'Sprint 2',
  state: 'closed',
  startDate: new Date('2025-02-01T00:00:00Z'),
  endDate: new Date('2025-02-15T00:00:00Z'),
  goal: '',
} as JiraSprint;

describe('pure helpers', () => {
  describe('sprintIdContains', () => {
    it('matches an exact sprint ID inside a comma-separated list', () => {
      expect(sprintIdContains('3864, 3903, 3941', '3941')).toBe(true);
    });
    it('does not match partial IDs', () => {
      expect(sprintIdContains('3940, 39410', '3941')).toBe(false);
    });
    it('returns false for null input', () => {
      expect(sprintIdContains(null, '3941')).toBe(false);
    });
  });

  describe('sprintValueContains', () => {
    it('matches an exact sprint name', () => {
      expect(sprintValueContains('Sprint 1, Sprint 2', 'Sprint 2')).toBe(true);
    });
    it('does not match "Sprint 1" against "Sprint 10"', () => {
      expect(sprintValueContains('Sprint 10', 'Sprint 1')).toBe(false);
    });
  });

  describe('isCarryOverFromSprint', () => {
    it('detects carry-over via ID when fromId references a closed sprint', () => {
      expect(
        isCarryOverFromSprint(
          null,
          '3903',
          'Sprint 2',
          '3941',
          new Set(),
          new Set(['3903']),
        ),
      ).toBe(true);
    });
    it('does not flag the current sprint as a carry-over source', () => {
      expect(
        isCarryOverFromSprint(
          null,
          '3941',
          'Sprint 2',
          '3941',
          new Set(),
          new Set(['3941']),
        ),
      ).toBe(false);
    });
    it('falls back to name when fromId is null', () => {
      expect(
        isCarryOverFromSprint(
          'Sprint 1',
          null,
          'Sprint 2',
          '3941',
          new Set(['Sprint 1']),
          new Set(),
        ),
      ).toBe(true);
    });
  });

  describe('wasInSprintAtDate', () => {
    it('returns true when issue has no sprint changelog (created in sprint)', () => {
      expect(
        wasInSprintAtDate([], 'Sprint 2', '3941', sprint.startDate!),
      ).toBe(true);
    });
    it('returns true when added before start (within grace window)', () => {
      const logs = [
        makeChangelog({
          toId: '3941',
          changedAt: new Date('2025-01-31T23:58:00Z'),
        }),
      ];
      expect(
        wasInSprintAtDate(logs, 'Sprint 2', '3941', sprint.startDate!),
      ).toBe(true);
    });
    it('returns false when added after grace window', () => {
      const logs = [
        makeChangelog({
          toId: '3941',
          changedAt: new Date('2025-02-01T01:00:00Z'),
        }),
      ];
      expect(
        wasInSprintAtDate(logs, 'Sprint 2', '3941', sprint.startDate!),
      ).toBe(false);
    });
  });
});

describe('SprintMembershipService.reconstruct', () => {
  let service: SprintMembershipService;
  let sprintRepo: jest.Mocked<Repository<JiraSprint>>;
  let issueSprintRepo: jest.Mocked<Repository<JiraIssueSprint>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;

  beforeEach(() => {
    sprintRepo = mockRepo<JiraSprint>();
    issueSprintRepo = mockRepo<JiraIssueSprint>();
    changelogRepo = mockRepo<JiraChangelog>();
    service = new SprintMembershipService(
      sprintRepo,
      issueSprintRepo,
      changelogRepo,
    );
  });

  function setChangelogs(rows: JiraChangelog[]): void {
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    });
  }

  function setClosedSprints(closed: Partial<JiraSprint>[]): void {
    sprintRepo.find.mockResolvedValue(closed as JiraSprint[]);
  }

  function setCurrentMembers(rows: { issueKey: string }[]): void {
    issueSprintRepo.find.mockResolvedValue(
      rows.map((r) => ({ ...r, sprintId: sprint.id })) as JiraIssueSprint[],
    );
  }

  it('returns empty membership when sprint has no startDate', async () => {
    const sprintNoStart = { ...sprint, startDate: null } as JiraSprint;
    const result = await service.reconstruct({
      sprint: sprintNoStart,
      boardId: 'ACC',
      boardIssues: [makeIssue({ key: 'ACC-1' })],
    });
    expect(result.committedKeys.size).toBe(0);
    expect(result.logsByIssue.size).toBe(0);
  });

  it('returns empty membership when no board issues are supplied', async () => {
    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [],
    });
    expect(result.committedKeys.size).toBe(0);
  });

  it('classifies an issue with no sprint changelog as committed via the join table', async () => {
    setChangelogs([]);
    setClosedSprints([]);
    setCurrentMembers([{ issueKey: 'ACC-99' }]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        makeIssue({ key: 'ACC-99', createdAt: new Date('2025-01-15') }),
      ],
    });

    expect(result.committedKeys.has('ACC-99')).toBe(true);
    expect(result.addedKeys.size).toBe(0);
  });

  it('classifies a mid-sprint creation as added', async () => {
    setChangelogs([]);
    setClosedSprints([]);
    setCurrentMembers([{ issueKey: 'ACC-100' }]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        // Created 5 days into the sprint window
        makeIssue({ key: 'ACC-100', createdAt: new Date('2025-02-06') }),
      ],
    });

    expect(result.addedKeys.has('ACC-100')).toBe(true);
    expect(result.committedKeys.size).toBe(0);
  });

  it('uses ID-based matching when fromId/toId are present (rename case)', async () => {
    // The ACC-48 case: sprint was renamed from "Ready to estimate 2" → "Sprint 2".
    // Changelog references the OLD name ("Ready to estimate 2") in toValue but
    // the current sprint ID (3941) in toId. Name-only matching would miss this.
    setChangelogs([
      makeChangelog({
        issueKey: 'ACC-48',
        fromId: null,
        toId: '3941',
        fromValue: 'Sprint 1',
        toValue: 'Sprint 1, Ready to estimate 2',
        changedAt: new Date('2025-01-31T23:55:00Z'), // before start, within grace
      }),
    ]);
    setClosedSprints([]);
    setCurrentMembers([{ issueKey: 'ACC-48' }]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        makeIssue({ key: 'ACC-48', createdAt: new Date('2025-01-10') }),
      ],
    });

    expect(result.committedKeys.has('ACC-48')).toBe(true);
    expect(result.addedKeys.size).toBe(0);
  });

  it('treats issues from closed prior sprints as carry-over (committed, not added)', async () => {
    // Issue moved from a CLOSED sprint (3903) into this sprint (3941) at start.
    setChangelogs([
      makeChangelog({
        issueKey: 'ACC-50',
        fromId: '3903',
        toId: '3903, 3941',
        changedAt: new Date('2025-02-01T00:01:00Z'), // exactly at start
      }),
    ]);
    setClosedSprints([
      { id: '3903', name: 'Sprint 1', endDate: new Date('2025-01-30') },
    ]);
    setCurrentMembers([{ issueKey: 'ACC-50' }]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        makeIssue({ key: 'ACC-50', createdAt: new Date('2025-01-15') }),
      ],
    });

    expect(result.committedKeys.has('ACC-50')).toBe(true);
    expect(result.addedKeys.size).toBe(0);
  });

  it('classifies an issue added mid-sprint (not from a closed sprint) as added', async () => {
    setChangelogs([
      makeChangelog({
        issueKey: 'ACC-60',
        fromId: null,
        toId: '3941',
        changedAt: new Date('2025-02-05T10:00:00Z'), // 4 days into sprint
      }),
    ]);
    setClosedSprints([]);
    setCurrentMembers([{ issueKey: 'ACC-60' }]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        makeIssue({ key: 'ACC-60', createdAt: new Date('2025-02-05') }),
      ],
    });

    expect(result.addedKeys.has('ACC-60')).toBe(true);
    expect(result.committedKeys.size).toBe(0);
  });

  it('classifies an issue removed before sprint end as removed', async () => {
    setChangelogs([
      makeChangelog({
        issueKey: 'ACC-70',
        fromId: null,
        toId: '3941',
        changedAt: new Date('2025-01-31T23:55:00Z'), // committed at start
      }),
      makeChangelog({
        issueKey: 'ACC-70',
        fromId: '3941',
        toId: null,
        changedAt: new Date('2025-02-10T10:00:00Z'), // removed mid-sprint
      }),
    ]);
    setClosedSprints([]);
    setCurrentMembers([]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        makeIssue({ key: 'ACC-70', createdAt: new Date('2025-01-10') }),
      ],
    });

    expect(result.committedKeys.has('ACC-70')).toBe(true);
    expect(result.removedKeys.has('ACC-70')).toBe(true);
  });

  it('falls back to name-based matching for legacy rows with no fromId/toId', async () => {
    setChangelogs([
      makeChangelog({
        issueKey: 'ACC-80',
        fromId: null,
        toId: null,
        fromValue: null,
        toValue: 'Sprint 2',
        changedAt: new Date('2025-01-31T23:55:00Z'),
      }),
    ]);
    setClosedSprints([]);
    setCurrentMembers([{ issueKey: 'ACC-80' }]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        makeIssue({ key: 'ACC-80', createdAt: new Date('2025-01-10') }),
      ],
    });

    expect(result.committedKeys.has('ACC-80')).toBe(true);
  });

  it('exposes currentMemberKeys from the join table', async () => {
    setChangelogs([]);
    setClosedSprints([]);
    setCurrentMembers([
      { issueKey: 'ACC-1' },
      { issueKey: 'ACC-2' },
    ]);

    const result = await service.reconstruct({
      sprint,
      boardId: 'ACC',
      boardIssues: [
        makeIssue({ key: 'ACC-1' }),
        makeIssue({ key: 'ACC-2' }),
      ],
    });

    expect(result.currentMemberKeys.size).toBe(2);
    expect(result.currentMemberKeys.has('ACC-1')).toBe(true);
    expect(result.currentMemberKeys.has('ACC-2')).toBe(true);
  });
});

describe('SprintMembershipService.reconstructMany', () => {
  let service: SprintMembershipService;
  let sprintRepo: jest.Mocked<Repository<JiraSprint>>;
  let issueSprintRepo: jest.Mocked<Repository<JiraIssueSprint>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;

  const sprint1: JiraSprint = {
    id: '3903',
    boardId: 'ACC',
    name: 'Sprint 1',
    state: 'closed',
    startDate: new Date('2025-01-15T00:00:00Z'),
    endDate: new Date('2025-01-31T00:00:00Z'),
    goal: '',
  } as JiraSprint;

  const sprint2: JiraSprint = {
    id: '3941',
    boardId: 'ACC',
    name: 'Sprint 2',
    state: 'closed',
    startDate: new Date('2025-02-01T00:00:00Z'),
    endDate: new Date('2025-02-15T00:00:00Z'),
    goal: '',
  } as JiraSprint;

  beforeEach(() => {
    sprintRepo = mockRepo<JiraSprint>();
    issueSprintRepo = mockRepo<JiraIssueSprint>();
    changelogRepo = mockRepo<JiraChangelog>();
    service = new SprintMembershipService(
      sprintRepo,
      issueSprintRepo,
      changelogRepo,
    );
  });

  function setChangelogs(rows: JiraChangelog[]): void {
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    });
  }

  it('returns an empty map when no sprints are supplied', async () => {
    const result = await service.reconstructMany({
      sprints: [],
      boardId: 'ACC',
      boardIssues: [makeIssue({ key: 'ACC-1' })],
    });
    expect(result.size).toBe(0);
  });

  it('seeds every sprint with an empty membership when no board issues exist', async () => {
    const result = await service.reconstructMany({
      sprints: [sprint1, sprint2],
      boardId: 'ACC',
      boardIssues: [],
    });
    expect(result.size).toBe(2);
    expect(result.get('3903')!.committedKeys.size).toBe(0);
    expect(result.get('3941')!.committedKeys.size).toBe(0);
  });

  it('skips sprints with no startDate but still seeds their entry', async () => {
    setChangelogs([]);
    const sprintNoStart = { ...sprint1, startDate: null } as JiraSprint;
    const result = await service.reconstructMany({
      sprints: [sprintNoStart, sprint2],
      boardId: 'ACC',
      boardIssues: [makeIssue({ key: 'ACC-1' })],
    });
    expect(result.has('3903')).toBe(true);
    expect(result.get('3903')!.committedKeys.size).toBe(0);
    expect(result.has('3941')).toBe(true);
  });

  it('issues one Sprint-field changelog query regardless of sprint count', async () => {
    setChangelogs([]);
    await service.reconstructMany({
      sprints: [sprint1, sprint2],
      boardId: 'ACC',
      boardIssues: [makeIssue({ key: 'ACC-1' }), makeIssue({ key: 'ACC-2' })],
    });
    expect(changelogRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
  });

  it('issues one JiraIssueSprint lookup spanning all requested sprint IDs', async () => {
    setChangelogs([]);
    await service.reconstructMany({
      sprints: [sprint1, sprint2],
      boardId: 'ACC',
      boardIssues: [makeIssue({ key: 'ACC-1' })],
    });
    expect(issueSprintRepo.find).toHaveBeenCalledTimes(1);
    const call = issueSprintRepo.find.mock.calls[0]![0]!;
    // Asserting the IN(...) shape exists; TypeORM's `In(...)` constructs an opaque object,
    // so we check the where clause is keyed by sprintId only.
    expect(Object.keys(call.where as object)).toEqual(['sprintId']);
  });

  it('classifies an issue committed to sprint1 and added to sprint2 (carry-over)', async () => {
    // ACC-1 starts in Sprint 1 (committed), then carried over to Sprint 2.
    setChangelogs([
      makeChangelog({
        issueKey: 'ACC-1',
        toId: '3903',
        toValue: 'Sprint 1',
        changedAt: new Date('2025-01-14T23:59:00Z'),
      }),
      makeChangelog({
        issueKey: 'ACC-1',
        fromId: '3903',
        fromValue: 'Sprint 1',
        toId: '3903, 3941',
        toValue: 'Sprint 1, Sprint 2',
        changedAt: new Date('2025-02-01T00:01:00Z'),
      }),
    ]);
    sprintRepo.find.mockResolvedValue([
      { id: '3903', name: 'Sprint 1', endDate: new Date('2025-01-31T00:00:00Z') },
    ] as JiraSprint[]);
    issueSprintRepo.find.mockResolvedValue([
      { issueKey: 'ACC-1', sprintId: '3941' },
    ] as JiraIssueSprint[]);

    const result = await service.reconstructMany({
      sprints: [sprint1, sprint2],
      boardId: 'ACC',
      boardIssues: [makeIssue({ key: 'ACC-1' })],
    });

    // Sprint 1: committed (in at start)
    expect(result.get('3903')!.committedKeys.has('ACC-1')).toBe(true);
    expect(result.get('3903')!.addedKeys.has('ACC-1')).toBe(false);
    // Sprint 2: carry-over from a CLOSED sprint ⇒ committed
    expect(result.get('3941')!.committedKeys.has('ACC-1')).toBe(true);
    expect(result.get('3941')!.addedKeys.has('ACC-1')).toBe(false);
  });

  it('produces independent membership sets per sprint', async () => {
    // ACC-1 only ever in Sprint 1; ACC-2 only ever in Sprint 2.
    setChangelogs([
      makeChangelog({
        issueKey: 'ACC-1',
        toId: '3903',
        toValue: 'Sprint 1',
        changedAt: new Date('2025-01-14T23:59:00Z'),
      }),
      makeChangelog({
        issueKey: 'ACC-2',
        toId: '3941',
        toValue: 'Sprint 2',
        changedAt: new Date('2025-01-31T23:59:00Z'),
      }),
    ]);

    const result = await service.reconstructMany({
      sprints: [sprint1, sprint2],
      boardId: 'ACC',
      boardIssues: [makeIssue({ key: 'ACC-1' }), makeIssue({ key: 'ACC-2' })],
    });

    expect(result.get('3903')!.committedKeys.has('ACC-1')).toBe(true);
    expect(result.get('3903')!.committedKeys.has('ACC-2')).toBe(false);
    expect(result.get('3941')!.committedKeys.has('ACC-2')).toBe(true);
    expect(result.get('3941')!.committedKeys.has('ACC-1')).toBe(false);
  });
});
