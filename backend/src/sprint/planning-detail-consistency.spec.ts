import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { PlanningService } from '../planning/planning.service.js';
import { SprintDetailService } from './sprint-detail.service.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';
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
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';

// ---------------------------------------------------------------------------
// Proposal 0050 — AC 7
//
// "Given the planning page and sprint detail page render the same sprint,
//  then they display identical commitment, added, and removed counts
//  (asserted by an integration test that drives both services from the
//  same membership fixture)."
//
// This spec wires PlanningService and SprintDetailService against a single
// shared SprintMembership fixture exhibiting mid-sprint churn and asserts
// the three numbers agree.
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

function mockConfigService(): jest.Mocked<ConfigService> {
  return {
    get: jest.fn().mockImplementation(
      (_key: string, defaultValue?: unknown) => defaultValue ?? 'UTC',
    ),
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

function mockMembershipService(
  membership: SprintMembership,
): jest.Mocked<SprintMembershipService> {
  return {
    reconstruct: jest.fn().mockResolvedValue(membership),
  } as unknown as jest.Mocked<SprintMembershipService>;
}

function makeIssue(key: string, status = 'To Do'): JiraIssue {
  return {
    key,
    boardId: 'ACC',
    issueType: 'Story',
    summary: key,
    status,
    epicKey: null,
    labels: [],
    points: null,
    priority: null,
    fixVersion: null,
    createdAt: new Date('2025-12-20T00:00:00Z'),
    updatedAt: new Date('2025-12-20T00:00:00Z'),
  } as unknown as JiraIssue;
}

const SPRINT: JiraSprint = {
  id: 'sprint-1',
  boardId: 'ACC',
  name: 'Sprint 1',
  state: 'closed',
  startDate: new Date('2026-01-05T00:00:00Z'),
  endDate: new Date('2026-01-19T00:00:00Z'),
  goal: '',
} as JiraSprint;

const SHARED_MEMBERSHIP: SprintMembership = {
  committedKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4']),
  addedKeys: new Set(['ACC-5', 'ACC-6']),
  committedRemovedKeys: new Set(['ACC-4']),
  addedRemovedKeys: new Set(['ACC-6']),
  currentMemberKeys: new Set(['ACC-1', 'ACC-2', 'ACC-3', 'ACC-5']),
  logsByIssue: new Map<string, JiraChangelog[]>(),
};

// All board issues that the two services see. Both services internally
// filter by isWorkItem(); all six are Stories.
const BOARD_ISSUES: JiraIssue[] = [
  makeIssue('ACC-1'),
  makeIssue('ACC-2'),
  makeIssue('ACC-3'),
  makeIssue('ACC-4'),
  makeIssue('ACC-5'),
  makeIssue('ACC-6'),
];

describe('planning ↔ sprint-detail consistency (proposal 0050 AC 7)', () => {
  it('reports identical commitment, added and removed counts for the same sprint', async () => {
    // -- PlanningService wiring -------------------------------------------
    const planningSprintRepo = mockRepo<JiraSprint>();
    const planningIssueRepo = mockRepo<JiraIssue>();
    const planningChangelogRepo = mockRepo<JiraChangelog>();
    const planningBoardConfigRepo = mockRepo<BoardConfig>();
    const planningMembership = mockMembershipService(SHARED_MEMBERSHIP);

    // Seed: one closed sprint (then one active query) for the board.
    planningSprintRepo.find
      .mockResolvedValueOnce([SPRINT])
      .mockResolvedValueOnce([]);
    planningIssueRepo.find.mockResolvedValue(BOARD_ISSUES);

    const planningService = new PlanningService(
      planningSprintRepo,
      planningIssueRepo,
      planningChangelogRepo,
      planningBoardConfigRepo,
      mockConfigService(),
      planningMembership,
    );

    // -- SprintDetailService wiring ---------------------------------------
    const detailSprintRepo = mockRepo<JiraSprint>();
    const detailIssueRepo = mockRepo<JiraIssue>();
    const detailChangelogRepo = mockRepo<JiraChangelog>();
    const detailBoardConfigRepo = mockRepo<BoardConfig>();
    const jpdIdeaRepo = mockRepo<JpdIdea>();
    const roadmapConfigRepo = mockRepo<RoadmapConfig>();
    const issueLinkRepo = mockRepo<JiraIssueLink>();
    const detailMembership = mockMembershipService(SHARED_MEMBERSHIP);

    detailSprintRepo.findOne.mockResolvedValue(SPRINT);
    detailBoardConfigRepo.findOne.mockResolvedValue({
      boardId: 'ACC',
      boardType: 'scrum',
      doneStatusNames: ['Done'],
      cancelledStatusNames: ['Cancelled'],
      inProgressStatusNames: ['In Progress'],
      failureIssueTypes: [],
      failureLabels: [],
      failureLinkTypes: [],
      incidentIssueTypes: [],
      incidentLabels: [],
      incidentPriorities: [],
      roadmapLinkTypes: [],
    } as unknown as BoardConfig);
    detailIssueRepo.find.mockResolvedValue(BOARD_ISSUES);

    const detailService = new SprintDetailService(
      detailSprintRepo,
      detailIssueRepo,
      detailChangelogRepo,
      detailBoardConfigRepo,
      jpdIdeaRepo,
      roadmapConfigRepo,
      issueLinkRepo,
      mockConfigService(),
      mockWorkingTimeService(),
      detailMembership,
    );

    // -- Drive both services ----------------------------------------------
    const planningResult = await planningService.getAccuracy('ACC');
    const detailResult = await detailService.getDetail('ACC', 'sprint-1');

    // Both services consumed the same membership fixture.
    expect(planningMembership.reconstruct).toHaveBeenCalledTimes(1);
    expect(detailMembership.reconstruct).toHaveBeenCalledTimes(1);

    // -- Canonical values from the shared membership ----------------------
    // commitment = |committedKeys| = 4
    // added      = |addedKeys|     = 2 (gross, includes ACC-6 which was removed)
    // removed    = |committedRemovedKeys| = 1 (committed-removed only)
    expect(planningResult).toHaveLength(1);
    expect(planningResult[0].commitment).toBe(4);
    expect(planningResult[0].added).toBe(2);
    expect(planningResult[0].removed).toBe(1);

    // The whole point of AC 7: the sprint detail page agrees.
    expect(detailResult.summary.committedCount).toBe(planningResult[0].commitment);
    expect(detailResult.summary.addedMidSprintCount).toBe(planningResult[0].added);
    expect(detailResult.summary.removedCount).toBe(planningResult[0].removed);
  });
});
