import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect } from '@jest/globals';
import { HealthcheckService } from './healthcheck.service.js';
import {
  BoardConfig,
  JiraIssue,
  JiraChangelog,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';
import {
  SprintMembershipService,
  type SprintMembership,
} from '../sprint-membership/sprint-membership.service.js';

// Selected week 2026-W30: Mon 2026-07-20 .. Sun 2026-07-26 (UTC).
const IN_WEEK = new Date('2026-07-21T10:00:00Z');
const BEFORE_WEEK = new Date('2026-07-10T10:00:00Z');

function issue(overrides: Partial<JiraIssue> & { key: string }): JiraIssue {
  return {
    summary: overrides.key,
    status: 'In Progress',
    issueType: 'Story',
    boardId: 'ACC',
    epicKey: null,
    labels: [],
    createdAt: new Date('2026-01-01'),
    ...overrides,
  } as unknown as JiraIssue;
}

function statusLog(issueKey: string, toValue: string, changedAt: Date): JiraChangelog {
  return { issueKey, field: 'status', toValue, changedAt } as JiraChangelog;
}

function config(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    boardId: 'ACC',
    boardType: 'scrum',
    doneStatusNames: ['Done'],
    inProgressStatusNames: ['In Progress'],
    cancelledStatusNames: ['Cancelled'],
    boardEntryStatuses: null,
    roadmapLinkTypes: [],
    supportLabels: [],
    supportLinkTypes: [],
    supportEpics: [],
    triageBoardKey: null,
    roadmapDeliveryTarget: 80,
    ...overrides,
  } as unknown as BoardConfig;
}

function sprint(overrides: Partial<JiraSprint> = {}): JiraSprint {
  return {
    id: 'S1',
    name: 'Sprint 1',
    state: 'active',
    startDate: new Date('2026-07-18T00:00:00Z'),
    endDate: new Date('2026-07-31T23:59:59Z'),
    completeDate: null,
    boardId: 'ACC',
    ...overrides,
  } as unknown as JiraSprint;
}

function membershipWith(committed: string[]): SprintMembership {
  return {
    committedKeys: new Set(committed),
    addedKeys: new Set(),
    committedRemovedKeys: new Set(),
    addedRemovedKeys: new Set(),
    currentMemberKeys: new Set(committed),
    logsByIssue: new Map(),
  };
}

interface Mocks {
  configs: BoardConfig[];
  issues: JiraIssue[];
  changelogs: JiraChangelog[];
  sprints: JiraSprint[];
  membership: Map<string, SprintMembership>;
}

async function buildService(mocks: Mocks): Promise<HealthcheckService> {
  const qb = (rows: unknown[]) => ({
    where: () => qb(rows),
    andWhere: () => qb(rows),
    orderBy: () => qb(rows),
    select: () => qb(rows),
    getMany: async () => rows,
  });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      HealthcheckService,
      { provide: getRepositoryToken(BoardConfig), useValue: { find: async () => mocks.configs } },
      {
        provide: getRepositoryToken(JiraIssue),
        useValue: { find: async () => mocks.issues },
      },
      {
        provide: getRepositoryToken(JiraChangelog),
        useValue: { createQueryBuilder: () => qb(mocks.changelogs) },
      },
      {
        provide: getRepositoryToken(JiraSprint),
        useValue: { find: async () => mocks.sprints },
      },
      {
        provide: getRepositoryToken(JiraIssueLink),
        useValue: { createQueryBuilder: () => qb([]) },
      },
      { provide: getRepositoryToken(JpdIdea), useValue: { find: async () => [] } },
      { provide: getRepositoryToken(RoadmapConfig), useValue: { find: async () => [] } },
      {
        provide: SprintMembershipService,
        useValue: { reconstructMany: async () => mocks.membership },
      },
      { provide: ConfigService, useValue: { get: (_k: string, d: string) => d } },
    ],
  }).compile();

  return module.get(HealthcheckService);
}

describe('HealthcheckService', () => {
  it('returns empty boards when no board configs exist', async () => {
    const service = await buildService({
      configs: [],
      issues: [],
      changelogs: [],
      sprints: [],
      membership: new Map(),
    });
    const result = await service.getHealthcheck('2026-W30');
    expect(result.boards).toEqual([]);
    expect(result.week).toBe('2026-W30');
  });

  it('computes scrum stability, roadmap and support against the shared denominator', async () => {
    const issues = [
      issue({ key: 'ACC-1', labels: ['support'] }),
      issue({ key: 'ACC-2' }),
    ];
    const changelogs = [
      statusLog('ACC-1', 'In Progress', IN_WEEK),
      statusLog('ACC-2', 'In Progress', IN_WEEK),
    ];
    const service = await buildService({
      configs: [config({ supportLabels: ['support'] })],
      issues,
      changelogs,
      sprints: [sprint()],
      // ACC-1 committed at start of the active sprint; ACC-2 not.
      membership: new Map([['S1', membershipWith(['ACC-1'])]]),
    });

    const result = await service.getHealthcheck('2026-W30');
    expect(result.boards).toHaveLength(1);
    const board = result.boards[0];
    expect(board.denominator).toBe(2);
    expect(board.stability.score).toBe(50); // 1 of 2 committed
    expect(board.stability.band).toBe('red');
    expect(board.support.score).toBe(50); // ACC-1 is support
    expect(board.support.band).toBe('red'); // burden > 40
  });

  it('excludes tickets whose first in-progress transition predates the week', async () => {
    const service = await buildService({
      configs: [config()],
      issues: [issue({ key: 'ACC-1' })],
      changelogs: [statusLog('ACC-1', 'In Progress', BEFORE_WEEK)],
      sprints: [sprint()],
      membership: new Map([['S1', membershipWith(['ACC-1'])]]),
    });
    const result = await service.getHealthcheck('2026-W30');
    expect(result.boards[0].denominator).toBe(0);
    expect(result.boards[0].stability.score).toBeNull();
  });

  it('returns N/A stability and roadmap for kanban boards but computes support', async () => {
    const service = await buildService({
      configs: [config({ boardId: 'PLAT', boardType: 'kanban', supportLabels: ['support'] })],
      issues: [issue({ key: 'PLAT-1', boardId: 'PLAT', labels: ['support'] })],
      changelogs: [statusLog('PLAT-1', 'To Do', IN_WEEK)],
      sprints: [],
      membership: new Map(),
    });
    const result = await service.getHealthcheck('2026-W30');
    const board = result.boards[0];
    expect(board.boardType).toBe('kanban');
    expect(board.denominator).toBe(1);
    expect(board.stability.score).toBeNull();
    expect(board.roadmap.score).toBeNull();
    expect(board.support.score).toBe(100);
  });

  it('returns an 8-point trend per board, oldest to newest, ending at the selected week', async () => {
    const service = await buildService({
      configs: [config()],
      issues: [issue({ key: 'ACC-1' })],
      changelogs: [statusLog('ACC-1', 'In Progress', IN_WEEK)],
      sprints: [sprint()],
      membership: new Map([['S1', membershipWith(['ACC-1'])]]),
    });
    const result = await service.getHealthcheck('2026-W30');
    const trend = result.boards[0].trend;
    expect(trend).toHaveLength(8);
    expect(trend[trend.length - 1].week).toBe('2026-W30');
    expect(trend[0].week).toBe('2026-W23');
  });
});
