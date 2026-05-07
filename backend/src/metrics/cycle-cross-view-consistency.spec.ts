/**
 * Cross-view cycle-time consistency (proposal 0054 AC §6).
 *
 * Drives all four services that surface a per-issue cycle time —
 * CycleTimeService, SupportService, WeekDetailService, SprintDetailService —
 * against a single shared changelog fixture and asserts every service
 * returns the same `cycleTimeDays` (within 0.01 days) for the same issue.
 *
 * The four services all consume `extractCycles` and pick the latest
 * completed cycle as the representative cycle. If any service drifts —
 * different status normalisation, different reset-name resolution,
 * different working-time wiring, different rounding — this spec catches it.
 */

import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { CycleTimeService } from './cycle-time.service.js';
import { WorkingTimeService } from './working-time.service.js';
import { SupportService } from '../support/support.service.js';
import { WeekDetailService } from '../week/week-detail.service.js';
import { SprintDetailService } from '../sprint/sprint-detail.service.js';
import {
  SprintMembershipService,
  type SprintMembership,
} from '../sprint-membership/sprint-membership.service.js';
import {
  BoardConfig,
  JiraChangelog,
  JiraIssue,
  JiraIssueLink,
  JiraSprint,
  JiraVersion,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------
//
// Two issues with IDENTICAL changelog patterns (one on a scrum board, one
// on a kanban board so that all four services can be exercised on the same
// canonical cycle):
//
//   IP   2026-01-06 09:00 UTC  →  Done 2026-01-08 17:00 UTC   [first cycle]
//   IP   2026-01-13 09:00 UTC  →  Done 2026-01-15 17:00 UTC   [reopen — representative]
//
// Latest cycle duration  = (15 17:00 − 13 09:00) = 2 days + 8 hours
//                        = 2.333…  →  round2 →  2.33
//
// All windows below contain that representative cycle:
//   • Q1 2026  (CycleTimeService, SupportService)  — 2026-01-01 → 2026-03-31
//   • Sprint   (SprintDetailService)               — 2026-01-05 → 2026-01-26
//   • W03 2026 (WeekDetailService)                 — 2026-01-12 → 2026-01-18
// ---------------------------------------------------------------------------

const EXPECTED_CYCLE_TIME_DAYS = 2.33;
const TOLERANCE = 0.01;

const SCRUM_BOARD_ID = 'ACC';
const KANBAN_BOARD_ID = 'PLAT';
const SCRUM_ISSUE_KEY = 'ACC-101';
const KANBAN_ISSUE_KEY = 'PLAT-101';
const SPRINT_ID = 'sprint-cross-view-1';
const QUARTER = '2026-Q1';
const WEEK = '2026-W03';

function statusChangelog(
  issueKey: string,
  toValue: string,
  isoDate: string,
  fromValue: string | null = null,
): JiraChangelog {
  return {
    id: 0, // value irrelevant — we only key on issueKey
    issueKey,
    field: 'status',
    fromValue,
    toValue,
    changedAt: new Date(isoDate),
  } as unknown as JiraChangelog;
}

function makeReopenLogs(issueKey: string): JiraChangelog[] {
  return [
    statusChangelog(issueKey, 'In Progress', '2026-01-06T09:00:00.000Z'),
    statusChangelog(issueKey, 'Done', '2026-01-08T17:00:00.000Z', 'In Progress'),
    statusChangelog(issueKey, 'In Progress', '2026-01-13T09:00:00.000Z', 'Done'),
    statusChangelog(issueKey, 'Done', '2026-01-15T17:00:00.000Z', 'In Progress'),
  ];
}

const SCRUM_LOGS = makeReopenLogs(SCRUM_ISSUE_KEY);
const KANBAN_LOGS = makeReopenLogs(KANBAN_ISSUE_KEY);

function makeScrumIssue(): JiraIssue {
  return {
    key: SCRUM_ISSUE_KEY,
    boardId: SCRUM_BOARD_ID,
    issueType: 'Story',
    summary: 'Reopen-pattern scrum issue',
    status: 'Done',
    epicKey: null,
    labels: ['support'], // matches supportLabels in scrum BoardConfig
    points: null,
    priority: null,
    fixVersion: null,
    statusId: null,
    createdAt: new Date('2026-01-05T00:00:00.000Z'),
    updatedAt: new Date('2026-01-15T17:00:00.000Z'),
  } as unknown as JiraIssue;
}

function makeKanbanIssue(): JiraIssue {
  return {
    key: KANBAN_ISSUE_KEY,
    boardId: KANBAN_BOARD_ID,
    issueType: 'Story',
    summary: 'Reopen-pattern kanban issue',
    status: 'Done',
    epicKey: null,
    labels: [],
    points: null,
    priority: null,
    fixVersion: null,
    statusId: null,
    // createdAt sits inside W03 2026 → passes WeekDetailService's
    // boardEntryDate-within-week filter (entry status not configured, so
    // entry date defaults to createdAt).
    createdAt: new Date('2026-01-13T08:00:00.000Z'),
    updatedAt: new Date('2026-01-15T17:00:00.000Z'),
  } as unknown as JiraIssue;
}

function makeScrumBoardConfig(): BoardConfig {
  return {
    boardId: SCRUM_BOARD_ID,
    boardType: 'scrum',
    doneStatusNames: ['Done'],
    inProgressStatusNames: ['In Progress'],
    cancelledStatusNames: ['Cancelled'],
    boardEntryStatuses: null,
    failureIssueTypes: [],
    failureLabels: [],
    failureLinkTypes: [],
    incidentIssueTypes: [],
    incidentLabels: [],
    incidentPriorities: [],
    roadmapLinkTypes: [],
    supportLabels: ['support'],
    supportLinkType: null,
    triageBoardKey: null,
    supportEpics: [],
    backlogStatusIds: [],
    dataStartDate: null,
  } as unknown as BoardConfig;
}

function makeKanbanBoardConfig(): BoardConfig {
  return {
    boardId: KANBAN_BOARD_ID,
    boardType: 'kanban',
    doneStatusNames: ['Done'],
    inProgressStatusNames: ['In Progress'],
    cancelledStatusNames: ['Cancelled'],
    boardEntryStatuses: null,
    failureIssueTypes: [],
    failureLabels: [],
    failureLinkTypes: [],
    incidentIssueTypes: [],
    incidentLabels: [],
    incidentPriorities: [],
    roadmapLinkTypes: [],
    supportLabels: [],
    supportLinkType: null,
    triageBoardKey: null,
    supportEpics: [],
    backlogStatusIds: [],
    dataStartDate: null,
  } as unknown as BoardConfig;
}

const SPRINT: JiraSprint = {
  id: SPRINT_ID,
  boardId: SCRUM_BOARD_ID,
  name: 'Sprint Cross-View 1',
  state: 'closed',
  startDate: new Date('2026-01-05T00:00:00.000Z'),
  endDate: new Date('2026-01-26T00:00:00.000Z'),
  goal: '',
} as unknown as JiraSprint;

// ---------------------------------------------------------------------------
// Repository / collaborator mocks
// ---------------------------------------------------------------------------

interface QueryBuilderMock {
  select: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  getMany: jest.Mock;
  getRawMany: jest.Mock;
}

function makeQueryBuilder(getManyResult: unknown[] = []): QueryBuilderMock {
  const qb: QueryBuilderMock = {
    select: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(getManyResult),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  qb.select.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.orderBy.mockReturnValue(qb);
  return qb;
}

function mockRepo<T extends object>(): jest.Mocked<Repository<T>> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn().mockReturnValue(makeQueryBuilder()),
  } as unknown as jest.Mocked<Repository<T>>;
}

function mockConfigService(): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      if (key === 'JIRA_BASE_URL') return '';
      if (key === 'TIMEZONE') return 'UTC';
      return defaultValue ?? '';
    }),
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

function membershipFor(issueKey: string): SprintMembership {
  return {
    committedKeys: new Set([issueKey]),
    addedKeys: new Set(),
    committedRemovedKeys: new Set(),
    addedRemovedKeys: new Set(),
    currentMemberKeys: new Set([issueKey]),
    logsByIssue: new Map<string, JiraChangelog[]>(),
  };
}

function mockMembershipService(
  membership: SprintMembership,
): jest.Mocked<SprintMembershipService> {
  return {
    reconstruct: jest.fn().mockResolvedValue(membership),
    reconstructMany: jest.fn().mockResolvedValue(new Map()),
  } as unknown as jest.Mocked<SprintMembershipService>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cycle-time cross-view consistency (proposal 0054 AC §6)', () => {
  it('CycleTimeService, SupportService, WeekDetailService and SprintDetailService all derive the same cycleTimeDays for the same issue', async () => {
    // -----------------------------------------------------------------------
    // 1) CycleTimeService — scrum issue, Q1 2026 window
    // -----------------------------------------------------------------------
    const ctIssueRepo = mockRepo<JiraIssue>();
    const ctChangelogRepo = mockRepo<JiraChangelog>();
    const ctVersionRepo = mockRepo<JiraVersion>();
    const ctBoardConfigRepo = mockRepo<BoardConfig>();

    ctBoardConfigRepo.findOne.mockResolvedValue(makeScrumBoardConfig());
    ctIssueRepo.find.mockResolvedValue([makeScrumIssue()]);
    ctChangelogRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(makeQueryBuilder(SCRUM_LOGS));

    const cycleTimeService = new CycleTimeService(
      ctIssueRepo,
      ctChangelogRepo,
      ctVersionRepo,
      ctBoardConfigRepo,
      mockConfigService(),
      mockWorkingTimeService(),
    );

    const ctResult = await cycleTimeService.calculate(
      SCRUM_BOARD_ID,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-03-31T23:59:59.999Z'),
      QUARTER,
    );

    expect(ctResult.observations).toHaveLength(1);
    const cycleTimeServiceDays = ctResult.observations[0].cycleTimeDays;
    expect(ctResult.observations[0].issueKey).toBe(SCRUM_ISSUE_KEY);
    expect(ctResult.observations[0].isReopen).toBe(true);

    // -----------------------------------------------------------------------
    // 2) SupportService — same scrum issue, Q1 2026 quarter
    // -----------------------------------------------------------------------
    const supIssueRepo = mockRepo<JiraIssue>();
    const supChangelogRepo = mockRepo<JiraChangelog>();
    const supVersionRepo = mockRepo<JiraVersion>();
    const supSprintRepo = mockRepo<JiraSprint>();
    const supBoardConfigRepo = mockRepo<BoardConfig>();
    const supIssueLinkRepo = mockRepo<JiraIssueLink>();

    supBoardConfigRepo.find.mockResolvedValue([makeScrumBoardConfig()]);
    supBoardConfigRepo.findOne.mockResolvedValue(makeScrumBoardConfig());
    supIssueRepo.find.mockResolvedValue([makeScrumIssue()]);
    // Two query-builder consumers in support: changelogRepo (status logs) and
    // sprintRepo (period sprints — return empty so no membership filtering).
    supChangelogRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(makeQueryBuilder(SCRUM_LOGS));
    supSprintRepo.createQueryBuilder = jest.fn().mockReturnValue(makeQueryBuilder([]));

    const supportService = new SupportService(
      supIssueRepo,
      supChangelogRepo,
      supVersionRepo,
      supSprintRepo,
      supBoardConfigRepo,
      supIssueLinkRepo,
      mockConfigService(),
      mockWorkingTimeService(),
      mockMembershipService(membershipFor(SCRUM_ISSUE_KEY)),
    );

    const supResults = await supportService.getSupportTickets({
      boardId: SCRUM_BOARD_ID,
      quarter: QUARTER,
    });

    expect(supResults).toHaveLength(1);
    expect(supResults[0].tickets).toHaveLength(1);
    const supportTicket = supResults[0].tickets[0];
    expect(supportTicket.issueKey).toBe(SCRUM_ISSUE_KEY);
    expect(supportTicket.isReopen).toBe(true);
    const supportServiceDays = supportTicket.cycleTimeDays;

    // -----------------------------------------------------------------------
    // 3) WeekDetailService — kanban issue, W03 2026
    // -----------------------------------------------------------------------
    const wdIssueRepo = mockRepo<JiraIssue>();
    const wdChangelogRepo = mockRepo<JiraChangelog>();
    const wdBoardConfigRepo = mockRepo<BoardConfig>();
    const wdRoadmapConfigRepo = mockRepo<RoadmapConfig>();
    const wdJpdIdeaRepo = mockRepo<JpdIdea>();
    const wdIssueLinkRepo = mockRepo<JiraIssueLink>();

    wdBoardConfigRepo.findOne.mockResolvedValue(makeKanbanBoardConfig());
    wdIssueRepo.find.mockResolvedValue([makeKanbanIssue()]);
    wdChangelogRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(makeQueryBuilder(KANBAN_LOGS));

    const weekDetailService = new WeekDetailService(
      wdIssueRepo,
      wdChangelogRepo,
      wdBoardConfigRepo,
      wdRoadmapConfigRepo,
      wdJpdIdeaRepo,
      wdIssueLinkRepo,
      mockConfigService(),
      mockWorkingTimeService(),
    );

    const wdResult = await weekDetailService.getDetail(KANBAN_BOARD_ID, WEEK);
    const wdIssue = wdResult.issues.find((i) => i.key === KANBAN_ISSUE_KEY);
    expect(wdIssue).toBeDefined();
    expect(wdIssue!.isReopen).toBe(true);
    const weekDetailServiceDays = wdIssue!.cycleTimeDays;

    // -----------------------------------------------------------------------
    // 4) SprintDetailService — same scrum issue, Sprint Cross-View 1
    // -----------------------------------------------------------------------
    const sdSprintRepo = mockRepo<JiraSprint>();
    const sdIssueRepo = mockRepo<JiraIssue>();
    const sdChangelogRepo = mockRepo<JiraChangelog>();
    const sdBoardConfigRepo = mockRepo<BoardConfig>();
    const sdJpdIdeaRepo = mockRepo<JpdIdea>();
    const sdRoadmapConfigRepo = mockRepo<RoadmapConfig>();
    const sdIssueLinkRepo = mockRepo<JiraIssueLink>();

    sdSprintRepo.findOne.mockResolvedValue(SPRINT);
    sdBoardConfigRepo.findOne.mockResolvedValue(makeScrumBoardConfig());
    sdIssueRepo.find.mockResolvedValue([makeScrumIssue()]);
    sdChangelogRepo.createQueryBuilder = jest
      .fn()
      .mockReturnValue(makeQueryBuilder(SCRUM_LOGS));

    const sprintDetailService = new SprintDetailService(
      sdSprintRepo,
      sdIssueRepo,
      sdChangelogRepo,
      sdBoardConfigRepo,
      sdJpdIdeaRepo,
      sdRoadmapConfigRepo,
      sdIssueLinkRepo,
      mockConfigService(),
      mockWorkingTimeService(),
      mockMembershipService(membershipFor(SCRUM_ISSUE_KEY)),
    );

    const sdResult = await sprintDetailService.getDetail(SCRUM_BOARD_ID, SPRINT_ID);
    const sdIssue = sdResult.issues.find((i) => i.key === SCRUM_ISSUE_KEY);
    expect(sdIssue).toBeDefined();
    expect(sdIssue!.isReopen).toBe(true);
    const sprintDetailServiceDays = sdIssue!.cycleTimeDays;

    // -----------------------------------------------------------------------
    // Cross-view assertion — all four services agree.
    // -----------------------------------------------------------------------
    expect(cycleTimeServiceDays).not.toBeNull();
    expect(supportServiceDays).not.toBeNull();
    expect(weekDetailServiceDays).not.toBeNull();
    expect(sprintDetailServiceDays).not.toBeNull();

    expect(Math.abs(cycleTimeServiceDays - EXPECTED_CYCLE_TIME_DAYS)).toBeLessThan(
      TOLERANCE,
    );
    expect(Math.abs((supportServiceDays ?? 0) - cycleTimeServiceDays)).toBeLessThan(
      TOLERANCE,
    );
    expect(
      Math.abs((weekDetailServiceDays ?? 0) - cycleTimeServiceDays),
    ).toBeLessThan(TOLERANCE);
    expect(
      Math.abs((sprintDetailServiceDays ?? 0) - cycleTimeServiceDays),
    ).toBeLessThan(TOLERANCE);
  });
});
