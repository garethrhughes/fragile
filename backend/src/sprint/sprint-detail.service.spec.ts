import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SprintDetailService } from './sprint-detail.service.js';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  BoardConfig,
  JpdIdea,
  RoadmapConfig,
  JiraIssueLink,
} from '../database/entities/index.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';
import {
  SprintMembershipService,
  type SprintMembership,
} from '../sprint-membership/sprint-membership.service.js';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  } as unknown as jest.Mocked<Repository<T>>;
}

function mockConfigService(jiraBaseUrl = ''): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockReturnValue(jiraBaseUrl),
  } as unknown as jest.Mocked<ConfigService>;
}

function mockWorkingTimeService(): jest.Mocked<WorkingTimeService> {
  return {
    getConfig: jest.fn().mockResolvedValue({
      id: 1,
      excludeWeekends: false,
      workDays: [1, 2, 3, 4, 5],
      hoursPerDay: 8,
      holidays: [],
    }),
    toConfig: jest.fn().mockReturnValue({
      timezone: 'UTC',
      workDays: [1, 2, 3, 4, 5],
      hoursPerDay: 8,
      holidays: [],
    }),
    workingDaysBetween: jest.fn(),
    workingHoursBetween: jest.fn(),
  } as unknown as jest.Mocked<WorkingTimeService>;
}

/**
 * Build an empty membership record (no committed/added/removed, no logs).
 */
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

/**
 * Build a membership that classifies every supplied key as committed.
 * Default fixture for tests that don't care about classification details.
 */
function committedMembership(keys: string[]): SprintMembership {
  return {
    committedKeys: new Set(keys),
    addedKeys: new Set<string>(),
    committedRemovedKeys: new Set<string>(),
    addedRemovedKeys: new Set<string>(),
    currentMemberKeys: new Set(keys),
    logsByIssue: new Map(keys.map((k) => [k, [] as JiraChangelog[]])),
  };
}

function mockSprintMembership(
  defaultMembership: SprintMembership = emptyMembership(),
): jest.Mocked<SprintMembershipService> {
  return {
    reconstruct: jest.fn().mockResolvedValue(defaultMembership),
  } as unknown as jest.Mocked<SprintMembershipService>;
}

/**
 * Build a status-changelog query-builder mock for a given set of rows.
 */
function makeStatusQb(rows: object[]) {
  return {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
}

const SPRINT: JiraSprint = {
  id: 'sprint-1',
  boardId: 'ACC',
  name: 'Sprint 1',
  state: 'active',
  startDate: new Date('2026-01-05T00:00:00Z'),
  endDate: new Date('2026-01-19T00:00:00Z'),
  goal: '',
} as JiraSprint;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeIssue(partial: Partial<JiraIssue> & { key: string }): JiraIssue {
  return {
    boardId: 'ACC',
    issueType: 'Story',
    summary: partial.key,
    status: 'To Do',
    epicKey: null,
    labels: [],
    points: null,
    priority: null,
    fixVersion: null,
    createdAt: new Date('2026-01-03T00:00:00Z'),
    updatedAt: new Date('2026-01-03T00:00:00Z'),
    ...partial,
  } as unknown as JiraIssue;
}

function defaultBoardConfig(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    boardId: 'ACC',
    boardType: 'scrum',
    doneStatusNames: ['Done'],
    cancelledStatusNames: ['Cancelled', "Won't Do"],
    inProgressStatusNames: ['In Progress'],
    failureIssueTypes: [],
    failureLabels: [],
    failureLinkTypes: [],
    incidentIssueTypes: [],
    incidentLabels: [],
    incidentPriorities: [],
    roadmapLinkTypes: [],
    ...overrides,
  } as unknown as BoardConfig;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SprintDetailService', () => {
  let service: SprintDetailService;
  let sprintRepo: jest.Mocked<Repository<JiraSprint>>;
  let issueRepo: jest.Mocked<Repository<JiraIssue>>;
  let changelogRepo: jest.Mocked<Repository<JiraChangelog>>;
  let boardConfigRepo: jest.Mocked<Repository<BoardConfig>>;
  let jpdIdeaRepo: jest.Mocked<Repository<JpdIdea>>;
  let roadmapConfigRepo: jest.Mocked<Repository<RoadmapConfig>>;
  let issueLinkRepo: jest.Mocked<Repository<JiraIssueLink>>;
  let workingTimeService: jest.Mocked<WorkingTimeService>;
  let sprintMembership: jest.Mocked<SprintMembershipService>;

  function buildService(jiraBaseUrl = ''): void {
    service = new SprintDetailService(
      sprintRepo,
      issueRepo,
      changelogRepo,
      boardConfigRepo,
      jpdIdeaRepo,
      roadmapConfigRepo,
      issueLinkRepo,
      mockConfigService(jiraBaseUrl),
      workingTimeService,
      sprintMembership,
    );
  }

  beforeEach(() => {
    sprintRepo = mockRepo<JiraSprint>();
    issueRepo = mockRepo<JiraIssue>();
    changelogRepo = mockRepo<JiraChangelog>();
    boardConfigRepo = mockRepo<BoardConfig>();
    jpdIdeaRepo = mockRepo<JpdIdea>();
    roadmapConfigRepo = mockRepo<RoadmapConfig>();
    issueLinkRepo = mockRepo<JiraIssueLink>();
    workingTimeService = mockWorkingTimeService();
    sprintMembership = mockSprintMembership();

    buildService();
  });

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  it('throws NotFoundException when sprint does not exist', async () => {
    sprintRepo.findOne.mockResolvedValue(null);

    await expect(service.getDetail('ACC', 'missing')).rejects.toThrow(
      NotFoundException,
    );
    expect(sprintMembership.reconstruct).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for Kanban boards', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(
      defaultBoardConfig({ boardType: 'kanban' }),
    );

    await expect(service.getDetail('ACC', 'sprint-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(sprintMembership.reconstruct).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Membership delegation
  // -------------------------------------------------------------------------

  it('returns empty response when board has no work issues', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([]);

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.sprintId).toBe('sprint-1');
    expect(result.issues).toHaveLength(0);
    expect(result.summary.committedCount).toBe(0);
    // No work issues => skip membership entirely.
    expect(sprintMembership.reconstruct).not.toHaveBeenCalled();
  });

  it('delegates membership reconstruction to SprintMembershipService', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    const issues = [makeIssue({ key: 'ACC-1' }), makeIssue({ key: 'ACC-2' })];
    issueRepo.find.mockResolvedValue(issues);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1', 'ACC-2']),
    );

    await service.getDetail('ACC', 'sprint-1');

    expect(sprintMembership.reconstruct).toHaveBeenCalledTimes(1);
    expect(sprintMembership.reconstruct).toHaveBeenCalledWith({
      sprint: SPRINT,
      boardId: 'ACC',
      boardIssues: issues,
    });
  });

  it('returns empty response when membership produces no committed/added issues', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1' })]);
    // Membership returns no issues for this sprint.
    sprintMembership.reconstruct.mockResolvedValue(emptyMembership());

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues).toHaveLength(0);
    expect(result.summary.committedCount).toBe(0);
  });

  it('surfaces committed, added and removed counts from membership', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1' }),
      makeIssue({ key: 'ACC-2' }),
      makeIssue({ key: 'ACC-3' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue({
      committedKeys: new Set(['ACC-1', 'ACC-3']),
      addedKeys: new Set(['ACC-2']),
      committedRemovedKeys: new Set(['ACC-3']),
      addedRemovedKeys: new Set(),
      currentMemberKeys: new Set(['ACC-1', 'ACC-2']),
      logsByIssue: new Map([
        ['ACC-1', []],
        ['ACC-2', []],
        ['ACC-3', []],
      ]),
    });

    const result = await service.getDetail('ACC', 'sprint-1');

    // committedCount and addedMidSprintCount are gross counts of the membership
    // sets — they include issues later removed (proposal 0050 / ADR 0052),
    // so the sprint detail page agrees with PlanningService.
    expect(result.summary.committedCount).toBe(2); // ACC-1, ACC-3 (incl. removed)
    expect(result.summary.addedMidSprintCount).toBe(1); // ACC-2
    expect(result.summary.removedCount).toBe(1); // committed-removed: ACC-3
    // Removed issue is excluded from the issues array (final = committed ∪ added \ removed).
    expect(result.issues.map((i) => i.key).sort()).toEqual(['ACC-1', 'ACC-2']);
    expect(result.issues.find((i) => i.key === 'ACC-1')?.addedMidSprint).toBe(
      false,
    );
    expect(result.issues.find((i) => i.key === 'ACC-2')?.addedMidSprint).toBe(
      true,
    );
  });

  it('excludes Epic and Sub-task issues before delegating to membership', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1' }),
      makeIssue({ key: 'ACC-2', issueType: 'Epic' }),
      makeIssue({ key: 'ACC-3', issueType: 'Sub-task' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );

    await service.getDetail('ACC', 'sprint-1');

    const call = sprintMembership.reconstruct.mock.calls[0][0];
    expect(call.boardIssues.map((i) => i.key)).toEqual(['ACC-1']);
  });

  // -------------------------------------------------------------------------
  // Status-changelog driven completion / lead time
  // -------------------------------------------------------------------------

  it('marks completedInSprint=true when status transitions to Done within sprint window', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'Done' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );
    changelogRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(
        makeStatusQb([
          {
            issueKey: 'ACC-1',
            field: 'status',
            toValue: 'In Progress',
            changedAt: new Date('2026-01-06T00:00:00Z'),
          },
          {
            issueKey: 'ACC-1',
            field: 'status',
            toValue: 'Done',
            changedAt: new Date('2026-01-08T00:00:00Z'),
          },
        ]),
      );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].completedInSprint).toBe(true);
    expect(result.summary.completedInSprintCount).toBe(1);
  });

  it('falls back to current status when no status changelog exists', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'Done' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );
    // No status changelog returned.

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].completedInSprint).toBe(true);
  });

  it('computes leadTimeDays from In Progress to Done in calendar days', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'Done' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );
    const inProgressAt = new Date('2026-01-06T00:00:00Z');
    const doneAt = new Date('2026-01-08T00:00:00Z');
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      makeStatusQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].leadTimeDays).toBe(2);
    expect(result.issues[0].resolvedAt).toBe(doneAt.toISOString());
    expect(result.summary.medianLeadTimeDays).toBe(2);
  });

  it('returns leadTimeDays=null when issue never reached Done', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'In Progress' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      makeStatusQb([
        {
          issueKey: 'ACC-1',
          field: 'status',
          toValue: 'In Progress',
          changedAt: new Date('2026-01-06T00:00:00Z'),
        },
      ]),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].leadTimeDays).toBeNull();
    expect(result.issues[0].resolvedAt).toBeNull();
    expect(result.summary.medianLeadTimeDays).toBeNull();
  });

  it('uses workingDaysBetween for leadTimeDays when excludeWeekends=true', async () => {
    workingTimeService.getConfig.mockResolvedValue({
      id: 1,
      excludeWeekends: true,
      workDays: [1, 2, 3, 4, 5],
      hoursPerDay: 8,
      holidays: [],
    });
    workingTimeService.workingDaysBetween.mockReturnValue(1);

    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'Done' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );
    const inProgressAt = new Date('2026-01-09T00:00:00Z'); // Friday
    const doneAt = new Date('2026-01-12T00:00:00Z'); // Monday
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      makeStatusQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: inProgressAt },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: doneAt },
      ]),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(workingTimeService.workingDaysBetween).toHaveBeenCalledWith(
      inProgressAt,
      doneAt,
      expect.anything(),
    );
    expect(result.issues[0].leadTimeDays).toBe(1);
  });

  // -------------------------------------------------------------------------
  // cycleTimeDays + isReopen (proposal 0054 AC4)
  // -------------------------------------------------------------------------

  it('surfaces isReopen=true when latest cycle follows a Done→In Progress reset', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'Done' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );
    // First cycle completes, then reopened and completed again within sprint.
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      makeStatusQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: new Date('2026-01-06T09:00:00Z') },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: new Date('2026-01-08T17:00:00Z') },
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: new Date('2026-01-13T09:00:00Z') },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: new Date('2026-01-15T17:00:00Z') },
      ]),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].isReopen).toBe(true);
    expect(result.issues[0].cycleTimeDays).not.toBeNull();
    expect(result.issues[0].cycleTimeDays!).toBeGreaterThan(0);
  });

  it('returns isReopen=false on a single non-reopened cycle', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'Done' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );
    changelogRepo.createQueryBuilder = jest.fn().mockReturnValue(
      makeStatusQb([
        { issueKey: 'ACC-1', field: 'status', toValue: 'In Progress', changedAt: new Date('2026-01-06T09:00:00Z') },
        { issueKey: 'ACC-1', field: 'status', toValue: 'Done', changedAt: new Date('2026-01-08T17:00:00Z') },
      ]),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].isReopen).toBe(false);
    expect(result.issues[0].cycleTimeDays).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Issue payload — priority, jiraUrl, sorting
  // -------------------------------------------------------------------------

  it('includes priority on each returned issue (including null)', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', priority: 'High' }),
      makeIssue({ key: 'ACC-2', priority: null }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1', 'ACC-2']),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    const acc1 = result.issues.find((i) => i.key === 'ACC-1');
    const acc2 = result.issues.find((i) => i.key === 'ACC-2');
    expect(acc1?.priority).toBe('High');
    expect(acc2?.priority).toBeNull();
  });

  it('includes jiraUrl when JIRA_BASE_URL is configured', async () => {
    buildService('https://example.atlassian.net');
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([makeIssue({ key: 'ACC-1' })]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].jiraUrl).toBe(
      'https://example.atlassian.net/browse/ACC-1',
    );
  });

  it('sorts incomplete issues before completed, then alphabetically by key', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-3', status: 'Done' }),
      makeIssue({ key: 'ACC-1', status: 'In Progress' }),
      makeIssue({ key: 'ACC-2', status: 'Done' }),
      makeIssue({ key: 'ACC-4', status: 'To Do' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4']),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    // Incomplete first (ACC-1, ACC-4 alphabetical), then completed (ACC-2, ACC-3).
    expect(result.issues.map((i) => i.key)).toEqual([
      'ACC-1',
      'ACC-4',
      'ACC-2',
      'ACC-3',
    ]);
  });

  // -------------------------------------------------------------------------
  // Cancelled status handling
  // -------------------------------------------------------------------------

  it('sets roadmapStatus="none" for cancelled issues even when an epic is linked', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: 'Cancelled', epicKey: 'ACC-0' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].roadmapStatus).toBe('none');
  });

  it('treats "Won\'t Do" as cancelled by default when boardConfig is null', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(null);
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', status: "Won't Do", epicKey: 'ACC-0' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].roadmapStatus).toBe('none');
  });

  // -------------------------------------------------------------------------
  // isIncident / isFailure
  // -------------------------------------------------------------------------

  it('marks Bug as isIncident and isFailure based on board config', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(
      defaultBoardConfig({
        failureIssueTypes: ['Bug'],
        incidentIssueTypes: ['Bug'],
      }),
    );
    issueRepo.find.mockResolvedValue([
      makeIssue({ key: 'ACC-1', issueType: 'Bug', status: 'In Progress' }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].isIncident).toBe(true);
    expect(result.issues[0].isFailure).toBe(true);
    expect(result.summary.incidentCount).toBe(1);
    expect(result.summary.failureCount).toBe(1);
  });

  it('marks isFailure when failure label matches', async () => {
    sprintRepo.findOne.mockResolvedValue(SPRINT);
    boardConfigRepo.findOne.mockResolvedValue(
      defaultBoardConfig({ failureLabels: ['production-incident'] }),
    );
    issueRepo.find.mockResolvedValue([
      makeIssue({
        key: 'ACC-1',
        issueType: 'Story',
        labels: ['production-incident'],
      }),
    ]);
    sprintMembership.reconstruct.mockResolvedValue(
      committedMembership(['ACC-1']),
    );

    const result = await service.getDetail('ACC', 'sprint-1');

    expect(result.issues[0].isFailure).toBe(true);
  });

  // -------------------------------------------------------------------------
  // B-4: missing BoardConfig fallback defaults
  // -------------------------------------------------------------------------

  describe('missing BoardConfig fallback defaults (B-4)', () => {
    it('classifies Bug as failure when boardConfig is null', async () => {
      sprintRepo.findOne.mockResolvedValue(SPRINT);
      boardConfigRepo.findOne.mockResolvedValue(null);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', issueType: 'Bug', status: 'Done' }),
      ]);
      sprintMembership.reconstruct.mockResolvedValue(
        committedMembership(['ACC-1']),
      );

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isFailure).toBe(true);
    });

    it('classifies Incident as failure when boardConfig is null', async () => {
      sprintRepo.findOne.mockResolvedValue(SPRINT);
      boardConfigRepo.findOne.mockResolvedValue(null);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', issueType: 'Incident' }),
      ]);
      sprintMembership.reconstruct.mockResolvedValue(
        committedMembership(['ACC-1']),
      );

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isFailure).toBe(true);
    });

    it('does NOT classify Story as failure when boardConfig is null', async () => {
      sprintRepo.findOne.mockResolvedValue(SPRINT);
      boardConfigRepo.findOne.mockResolvedValue(null);
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', issueType: 'Story', status: 'Done' }),
      ]);
      sprintMembership.reconstruct.mockResolvedValue(
        committedMembership(['ACC-1']),
      );

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isFailure).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // B-2: incidentPriorities AND-gate
  // -------------------------------------------------------------------------

  describe('incidentPriorities AND-gate (B-2)', () => {
    function setup(priority: string | null, incidentPriorities: string[]) {
      sprintRepo.findOne.mockResolvedValue(SPRINT);
      boardConfigRepo.findOne.mockResolvedValue(
        defaultBoardConfig({
          failureIssueTypes: ['Bug', 'Incident'],
          incidentIssueTypes: ['Bug', 'Incident'],
          incidentPriorities,
        }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', issueType: 'Bug', status: 'Done', priority }),
      ]);
      sprintMembership.reconstruct.mockResolvedValue(
        committedMembership(['ACC-1']),
      );
    }

    it('Medium priority is NOT incident when allowlist=[Critical, Highest]', async () => {
      setup('Medium', ['Critical', 'Highest']);

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isIncident).toBe(false);
    });

    it('Critical priority IS incident when allowlist=[Critical, Highest]', async () => {
      setup('Critical', ['Critical', 'Highest']);

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isIncident).toBe(true);
    });

    it('any priority IS incident when allowlist is empty (gate disabled)', async () => {
      setup('Low', []);

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isIncident).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // failureLinkTypes AND-gate (Proposal 0032)
  // -------------------------------------------------------------------------

  describe('failureLinkTypes AND-gate', () => {
    function setup(failureLinkTypes: string[], linkRows: object[]): void {
      sprintRepo.findOne.mockResolvedValue(SPRINT);
      boardConfigRepo.findOne.mockResolvedValue(
        defaultBoardConfig({
          failureIssueTypes: ['Bug'],
          failureLinkTypes,
        }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({ key: 'ACC-1', issueType: 'Bug', status: 'In Progress' }),
      ]);
      sprintMembership.reconstruct.mockResolvedValue(
        committedMembership(['ACC-1']),
      );
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(linkRows),
        getMany: jest.fn().mockResolvedValue([]),
      });
    }

    it('does NOT mark as failure when failureLinkTypes is set and no causal link exists', async () => {
      setup(['caused by'], []);

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isFailure).toBe(false);
    });

    it('marks as failure when failureLinkTypes is set and a causal link exists', async () => {
      setup(['caused by'], [{ key: 'ACC-1' }]);

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isFailure).toBe(true);
    });

    it('skips the link gate when failureLinkTypes is empty', async () => {
      setup([], []);

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isFailure).toBe(true);
      expect(issueLinkRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('matches link types case-insensitively', async () => {
      setup(['Caused By'], [{ key: 'ACC-1' }]);

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].isFailure).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // roadmapStatus — sprint-state aware (active vs closed)
  // -------------------------------------------------------------------------

  describe('roadmapStatus (epic-linked)', () => {
    function setupEpicScenario(opts: {
      sprintState: 'active' | 'closed';
      issueStatus: string;
      targetDate: Date;
      resolvedAt?: Date;
    }): void {
      const sprint: JiraSprint = {
        ...SPRINT,
        state: opts.sprintState,
      } as JiraSprint;
      sprintRepo.findOne.mockResolvedValue(sprint);
      boardConfigRepo.findOne.mockResolvedValue(defaultBoardConfig());
      issueRepo.find.mockResolvedValue([
        makeIssue({
          key: 'ACC-1',
          status: opts.issueStatus,
          epicKey: 'ACC-EPIC-1',
        }),
      ]);
      sprintMembership.reconstruct.mockResolvedValue(
        committedMembership(['ACC-1']),
      );
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'PT' } as RoadmapConfig,
      ]);
      jpdIdeaRepo.find.mockResolvedValue([
        Object.assign(new JpdIdea(), {
          key: 'PT-1',
          jpdKey: 'PT',
          targetDate: opts.targetDate,
          startDate: new Date('2026-01-01'),
          deliveryIssueKeys: ['ACC-EPIC-1'],
          summary: 'Epic idea',
        }),
      ]);
      const statusRows = opts.resolvedAt
        ? [
            {
              issueKey: 'ACC-1',
              field: 'status',
              fromValue: 'In Progress',
              toValue: 'Done',
              changedAt: opts.resolvedAt,
            },
          ]
        : [];
      changelogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeStatusQb(statusRows));
    }

    it('returns "in-scope" when issue resolved before targetDate', async () => {
      setupEpicScenario({
        sprintState: 'closed',
        issueStatus: 'Done',
        targetDate: new Date('2026-06-30T00:00:00Z'),
        resolvedAt: new Date('2026-06-15T00:00:00Z'),
      });

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].roadmapStatus).toBe('in-scope');
    });

    it('returns "linked" when issue not resolved in a closed sprint', async () => {
      setupEpicScenario({
        sprintState: 'closed',
        issueStatus: 'In Progress',
        targetDate: new Date('2026-01-10T00:00:00Z'),
      });

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].roadmapStatus).toBe('linked');
    });

    it('returns "linked" when issue resolved AFTER targetDate', async () => {
      setupEpicScenario({
        sprintState: 'closed',
        issueStatus: 'Done',
        targetDate: new Date('2026-01-10T00:00:00Z'),
        resolvedAt: new Date('2026-01-15T00:00:00Z'),
      });

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].roadmapStatus).toBe('linked');
    });

    it('returns "in-scope" for In Progress issue in active sprint with future targetDate', async () => {
      setupEpicScenario({
        sprintState: 'active',
        issueStatus: 'In Progress',
        targetDate: new Date('2099-01-01T00:00:00Z'),
      });

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].roadmapStatus).toBe('in-scope');
    });

    it('returns "linked" for In Progress issue in active sprint with past targetDate', async () => {
      setupEpicScenario({
        sprintState: 'active',
        issueStatus: 'In Progress',
        targetDate: new Date('2020-01-01T00:00:00Z'),
      });

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].roadmapStatus).toBe('linked');
    });
  });

  // -------------------------------------------------------------------------
  // roadmapLinkSource — direct Jira issue link to JPD idea (ADR 0044)
  // -------------------------------------------------------------------------

  describe('roadmapLinkSource — direct link', () => {
    function setupDirect(opts: {
      roadmapLinkTypes: string[];
      linkTypeName: string;
      targetDate: Date;
      sprintState?: 'active' | 'closed';
      resolvedAt?: Date;
    }): void {
      const sprint: JiraSprint = {
        ...SPRINT,
        state: opts.sprintState ?? 'active',
      } as JiraSprint;
      sprintRepo.findOne.mockResolvedValue(sprint);
      boardConfigRepo.findOne.mockResolvedValue(
        defaultBoardConfig({
          doneStatusNames: ['Done', 'Closed', 'Released'],
          roadmapLinkTypes: opts.roadmapLinkTypes,
        }),
      );
      issueRepo.find.mockResolvedValue([
        makeIssue({
          key: 'ACC-99',
          status: opts.resolvedAt ? 'Done' : 'In Progress',
          points: 3,
        }),
      ]);
      sprintMembership.reconstruct.mockResolvedValue(
        committedMembership(['ACC-99']),
      );
      roadmapConfigRepo.find.mockResolvedValue([
        { jpdKey: 'PT' } as RoadmapConfig,
      ]);
      jpdIdeaRepo.find.mockResolvedValue([
        Object.assign(new JpdIdea(), {
          key: 'PT-389',
          jpdKey: 'PT',
          targetDate: opts.targetDate,
          startDate: new Date('2026-01-01'),
          deliveryIssueKeys: [],
          summary: 'Roadmap item',
        }),
      ]);

      const statusRows = opts.resolvedAt
        ? [
            {
              issueKey: 'ACC-99',
              field: 'status',
              fromValue: 'In Progress',
              toValue: 'Done',
              changedAt: opts.resolvedAt,
            },
          ]
        : [];
      changelogRepo.createQueryBuilder = jest
        .fn()
        .mockReturnValue(makeStatusQb(statusRows));

      const linkRows =
        opts.roadmapLinkTypes.length > 0 &&
        opts.roadmapLinkTypes
          .map((t) => t.toLowerCase())
          .includes(opts.linkTypeName.toLowerCase())
          ? [
              {
                sourceIssueKey: 'ACC-99',
                targetIssueKey: 'PT-389',
                linkTypeName: opts.linkTypeName,
              },
            ]
          : [];
      issueLinkRepo.createQueryBuilder = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(linkRows),
        getRawMany: jest.fn().mockResolvedValue([]),
      });
    }

    it('sets roadmapLinkSource="direct" and roadmapStatus="in-scope" when resolved before target', async () => {
      setupDirect({
        roadmapLinkTypes: ['is connected to'],
        linkTypeName: 'is connected to',
        targetDate: new Date('2026-06-30T00:00:00Z'),
        resolvedAt: new Date('2026-06-15T10:00:00Z'),
      });

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].roadmapLinkSource).toBe('direct');
      expect(result.issues[0].roadmapStatus).toBe('in-scope');
    });

    it('sets roadmapLinkSource=null and roadmapStatus="none" when roadmapLinkTypes is empty', async () => {
      setupDirect({
        roadmapLinkTypes: [],
        linkTypeName: 'is connected to',
        targetDate: new Date('2026-06-30T00:00:00Z'),
      });

      const result = await service.getDetail('ACC', 'sprint-1');

      expect(result.issues[0].roadmapLinkSource).toBeNull();
      expect(result.issues[0].roadmapStatus).toBe('none');
      expect(issueLinkRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
