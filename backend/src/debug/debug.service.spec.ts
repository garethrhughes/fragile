import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { describe, it, expect } from '@jest/globals';
import { DebugService } from './debug.service.js';
import {
  JiraIssue,
  JiraChangelog,
  JiraIssueSprint,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
} from '../database/entities/index.js';

function issue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'ACC-1',
    summary: 'Test issue',
    status: 'In Progress',
    statusId: null,
    issueType: 'Story',
    fixVersion: null,
    points: 3,
    boardId: 'ACC',
    epicKey: null,
    labels: [],
    priority: null,
    assignee: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    inBacklog: false,
    ...overrides,
  } as JiraIssue;
}

interface Mocks {
  issue: JiraIssue | null;
  changelogs?: JiraChangelog[];
  memberships?: JiraIssueSprint[];
  sprints?: JiraSprint[];
  links?: JiraIssueLink[];
  ideas?: JpdIdea[];
}

async function buildService(mocks: Mocks): Promise<DebugService> {
  const qb = (rows: unknown[]) => ({
    where: () => qb(rows),
    andWhere: () => qb(rows),
    orWhere: () => qb(rows),
    orderBy: () => qb(rows),
    getMany: async () => rows,
  });

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DebugService,
      {
        provide: getRepositoryToken(JiraIssue),
        useValue: { findOne: async () => mocks.issue },
      },
      {
        provide: getRepositoryToken(JiraChangelog),
        useValue: { createQueryBuilder: () => qb(mocks.changelogs ?? []) },
      },
      {
        provide: getRepositoryToken(JiraIssueSprint),
        useValue: { find: async () => mocks.memberships ?? [] },
      },
      {
        provide: getRepositoryToken(JiraSprint),
        useValue: { find: async () => mocks.sprints ?? [] },
      },
      {
        provide: getRepositoryToken(JiraIssueLink),
        useValue: {
          find: async (opts?: { where?: { sourceIssueKey?: string; targetIssueKey?: string } }) => {
            const all = mocks.links ?? [];
            if (opts?.where?.sourceIssueKey) {
              return all.filter((l) => l.sourceIssueKey === opts.where!.sourceIssueKey);
            }
            if (opts?.where?.targetIssueKey) {
              return all.filter((l) => l.targetIssueKey === opts.where!.targetIssueKey);
            }
            return all;
          },
        },
      },
      {
        provide: getRepositoryToken(JpdIdea),
        useValue: { createQueryBuilder: () => qb(mocks.ideas ?? []) },
      },
    ],
  }).compile();

  return module.get(DebugService);
}

describe('DebugService', () => {
  it('throws NotFound when the issue key is not stored', async () => {
    const service = await buildService({ issue: null });
    await expect(service.getIssueDebug('NOPE-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the issue row for a stored key', async () => {
    const service = await buildService({ issue: issue({ key: 'ACC-1' }) });
    const result = await service.getIssueDebug('ACC-1');
    expect(result.issue.key).toBe('ACC-1');
  });

  it('returns changelog entries ordered as loaded, serialising dates to ISO', async () => {
    const service = await buildService({
      issue: issue(),
      changelogs: [
        { id: 1, issueKey: 'ACC-1', field: 'status', fromValue: 'To Do', toValue: 'In Progress', fromId: null, toId: null, changedAt: new Date('2026-01-03T10:00:00Z') } as JiraChangelog,
        { id: 2, issueKey: 'ACC-1', field: 'Sprint', fromValue: null, toValue: 'Sprint 1', fromId: null, toId: '10', changedAt: new Date('2026-01-04T10:00:00Z') } as JiraChangelog,
      ],
    });
    const result = await service.getIssueDebug('ACC-1');
    expect(result.changelog).toHaveLength(2);
    expect(result.changelog[0].field).toBe('status');
    expect(result.changelog[0].changedAt).toBe('2026-01-03T10:00:00.000Z');
    expect(result.changelog[1].field).toBe('Sprint');
  });

  it('joins sprint memberships to their sprint details', async () => {
    const service = await buildService({
      issue: issue(),
      memberships: [{ issueKey: 'ACC-1', sprintId: 'S1' } as JiraIssueSprint],
      sprints: [
        {
          id: 'S1',
          name: 'Sprint 1',
          state: 'closed',
          startDate: new Date('2026-01-01T00:00:00Z'),
          endDate: new Date('2026-01-14T00:00:00Z'),
          completeDate: null,
          boardId: 'ACC',
        } as JiraSprint,
      ],
    });
    const result = await service.getIssueDebug('ACC-1');
    expect(result.sprintMemberships).toHaveLength(1);
    expect(result.sprintMemberships[0]).toMatchObject({
      sprintId: 'S1',
      name: 'Sprint 1',
      state: 'closed',
      boardId: 'ACC',
    });
  });

  it('reports a membership with null sprint details when the sprint row is missing', async () => {
    const service = await buildService({
      issue: issue(),
      memberships: [{ issueKey: 'ACC-1', sprintId: 'GONE' } as JiraIssueSprint],
      sprints: [],
    });
    const result = await service.getIssueDebug('ACC-1');
    expect(result.sprintMemberships[0]).toMatchObject({ sprintId: 'GONE', name: null });
  });

  it('splits links into source and target', async () => {
    const service = await buildService({
      issue: issue({ key: 'ACC-1' }),
      links: [
        { id: 1, sourceIssueKey: 'ACC-1', targetIssueKey: 'TTB-9', linkTypeName: 'clones', isInward: false } as JiraIssueLink,
        { id: 2, sourceIssueKey: 'BPT-2', targetIssueKey: 'ACC-1', linkTypeName: 'blocks', isInward: true } as JiraIssueLink,
      ],
    });
    const result = await service.getIssueDebug('ACC-1');
    expect(result.linksAsSource.map((l) => l.id)).toEqual([1]);
    expect(result.linksAsTarget.map((l) => l.id)).toEqual([2]);
  });

  it('matches roadmap ideas via the issue key (direct) and via the epic key', async () => {
    const service = await buildService({
      issue: issue({ key: 'ACC-1', epicKey: 'ACC-100' }),
      ideas: [
        { key: 'IDEA-1', summary: 'Direct', status: 'Now', jpdKey: 'JPD', deliveryIssueKeys: ['ACC-1'], startDate: null, targetDate: null } as JpdIdea,
        { key: 'IDEA-2', summary: 'Via epic', status: 'Now', jpdKey: 'JPD', deliveryIssueKeys: ['ACC-100'], startDate: null, targetDate: null } as JpdIdea,
        { key: 'IDEA-3', summary: 'Unrelated', status: 'Now', jpdKey: 'JPD', deliveryIssueKeys: ['ZZZ-9'], startDate: null, targetDate: null } as JpdIdea,
      ],
    });
    const result = await service.getIssueDebug('ACC-1');
    const byKey = Object.fromEntries(result.roadmapIdeas.map((i) => [i.key, i]));
    expect(byKey['IDEA-1']?.matchReason).toBe('direct');
    expect(byKey['IDEA-2']?.matchReason).toBe('epic');
    expect(byKey['IDEA-3']).toBeUndefined();
  });
});
