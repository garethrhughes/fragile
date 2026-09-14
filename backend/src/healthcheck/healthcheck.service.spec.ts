import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { describe, it, expect, jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { HealthcheckService } from './healthcheck.service.js';
import {
  BoardConfig,
  JiraIssue,
  JiraChangelog,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
  RoadmapConfig,
  HealthcheckSnapshot,
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
  /** Pre-seeded stored weeks. Written through by the service on first read. */
  snapshots?: HealthcheckSnapshot[];
}

/**
 * In-memory stand-in for the `healthcheck_snapshots` table, so the stored /
 * live / drift paths (ADR 0092) can be exercised without a database.
 */
function snapshotRepoMock(store: HealthcheckSnapshot[]) {
  return {
    findOne: async (opts: { where: { week: string } }) =>
      store.find((s) => s.week === opts.where.week) ?? null,
    // Trend points are read from each week's own stored row so the chart and the
    // score cards cannot disagree. `In(weeks)` is matched against `_value`.
    find: async (opts?: { where?: { week?: { _value?: string[] } } }) => {
      const weeks = opts?.where?.week?._value;
      return weeks ? store.filter((s) => weeks.includes(s.week)) : [...store];
    },
    create: (row: HealthcheckSnapshot) => row,
    save: async (row: HealthcheckSnapshot) => {
      const i = store.findIndex((s) => s.week === row.week);
      if (i >= 0) store[i] = row;
      else store.push(row);
      return row;
    },
  };
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
        useValue: {
          find: async (opts?: { where?: { boardId?: string } }) => {
            const boardId = opts?.where?.boardId
            return boardId ? mocks.issues.filter((i) => i.boardId === boardId) : mocks.issues
          },
        },
      },
      {
        provide: getRepositoryToken(JiraChangelog),
        useValue: { createQueryBuilder: () => qb(mocks.changelogs) },
      },
      {
        provide: getRepositoryToken(JiraSprint),
        useValue: {
          find: async (opts?: { where?: { boardId?: string } }) => {
            const boardId = opts?.where?.boardId
            return boardId ? mocks.sprints.filter((s) => s.boardId === boardId) : mocks.sprints
          },
        },
      },
      {
        provide: getRepositoryToken(JiraIssueLink),
        useValue: { createQueryBuilder: () => qb([]) },
      },
      { provide: getRepositoryToken(JpdIdea), useValue: { find: async () => [] } },
      { provide: getRepositoryToken(RoadmapConfig), useValue: { find: async () => [] } },
      {
        provide: getRepositoryToken(HealthcheckSnapshot),
        useValue: snapshotRepoMock((mocks.snapshots ??= [])),
      },
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
    expect(result.stability.score).toBeNull();
    expect(result.roadmap.score).toBeNull();
    expect(result.support.score).toBeNull();
    expect(result.week).toBe('2026-W30');
  });

  it('computes pooled scrum stability, roadmap and support for a single board', async () => {
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
    expect(result.stability.denominator).toBe(2);
    expect(result.stability.score).toBe(50); // 1 of 2 committed
    expect(result.stability.band).toBe('red');
    expect(result.support.score).toBe(50); // ACC-1 is support
    expect(result.support.band).toBe('red'); // burden > 40
  });

  it('pools numerators and denominators across multiple boards', async () => {
    // ACC (scrum): 2 started, 1 committed. BPT (scrum): 2 started, 2 committed.
    // Pooled stability = 3 / 4 = 75.
    const issues = [
      issue({ key: 'ACC-1', boardId: 'ACC' }),
      issue({ key: 'ACC-2', boardId: 'ACC' }),
      issue({ key: 'BPT-1', boardId: 'BPT' }),
      issue({ key: 'BPT-2', boardId: 'BPT' }),
    ]
    const changelogs = [
      statusLog('ACC-1', 'In Progress', IN_WEEK),
      statusLog('ACC-2', 'In Progress', IN_WEEK),
      statusLog('BPT-1', 'In Progress', IN_WEEK),
      statusLog('BPT-2', 'In Progress', IN_WEEK),
    ]
    const service = await buildService({
      configs: [config({ boardId: 'ACC' }), config({ boardId: 'BPT' })],
      issues,
      changelogs,
      sprints: [sprint({ boardId: 'ACC' }), sprint({ id: 'S2', boardId: 'BPT' })],
      membership: new Map([
        ['S1', membershipWith(['ACC-1'])],
        ['S2', membershipWith(['BPT-1', 'BPT-2'])],
      ]),
    })

    const result = await service.getHealthcheck('2026-W30')
    expect(result.stability.denominator).toBe(4)
    expect(result.stability.numerator).toBe(3)
    expect(result.stability.score).toBe(75)
    expect(result.stability.band).toBe('amber')
  })

  it('excludes support tickets from Stability/Roadmap when includeSupport=false, leaving Support unchanged', async () => {
    // ACC-1 is support AND committed; ACC-2 is committed non-support.
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
      membership: new Map([['S1', membershipWith(['ACC-1', 'ACC-2'])]]),
    });

    const result = await service.getHealthcheck('2026-W30', false);
    // Support ticket ACC-1 dropped from the Stability denominator: 1 of 1 committed.
    expect(result.stability.denominator).toBe(1);
    expect(result.stability.numerator).toBe(1);
    expect(result.stability.score).toBe(100);
    // Support dimension keeps the full denominator (both started tickets).
    expect(result.support.denominator).toBe(2);
    expect(result.support.numerator).toBe(1);
    expect(result.support.score).toBe(50);
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
    expect(result.stability.denominator).toBe(0);
    expect(result.stability.score).toBeNull();
  });

  it('excludes kanban boards from Stability/Roadmap but pools their Support', async () => {
    const service = await buildService({
      configs: [config({ boardId: 'PLAT', boardType: 'kanban', supportLabels: ['support'] })],
      issues: [issue({ key: 'PLAT-1', boardId: 'PLAT', labels: ['support'] })],
      changelogs: [statusLog('PLAT-1', 'To Do', IN_WEEK)],
      sprints: [],
      membership: new Map(),
    });
    const result = await service.getHealthcheck('2026-W30');
    // No scrum board contributes → Stability/Roadmap denominators are 0 (N/A).
    expect(result.stability.score).toBeNull();
    expect(result.roadmap.score).toBeNull();
    // Support pools the kanban board.
    expect(result.support.denominator).toBe(1);
    expect(result.support.score).toBe(100);
  });

  it('returns an 8-point org trend, oldest to newest, ending at the selected week', async () => {
    const service = await buildService({
      configs: [config()],
      issues: [issue({ key: 'ACC-1' })],
      changelogs: [statusLog('ACC-1', 'In Progress', IN_WEEK)],
      sprints: [sprint()],
      membership: new Map([['S1', membershipWith(['ACC-1'])]]),
    });
    const result = await service.getHealthcheck('2026-W30');
    const trend = result.trend;
    expect(trend).toHaveLength(8);
    expect(trend[trend.length - 1].week).toBe('2026-W30');
    expect(trend[0].week).toBe('2026-W23');
  });

  it('returns the selected week tickets with dimension flags across all boards', async () => {
    const issues = [
      issue({ key: 'ACC-1', boardId: 'ACC', labels: ['support'] }),
      issue({ key: 'ACC-2', boardId: 'ACC' }),
      issue({ key: 'PLAT-1', boardId: 'PLAT' }),
    ]
    const changelogs = [
      statusLog('ACC-1', 'In Progress', IN_WEEK),
      statusLog('ACC-2', 'In Progress', IN_WEEK),
      statusLog('PLAT-1', 'To Do', IN_WEEK),
    ]
    const service = await buildService({
      configs: [
        config({ boardId: 'ACC', supportLabels: ['support'] }),
        config({ boardId: 'PLAT', boardType: 'kanban' }),
      ],
      issues,
      changelogs,
      sprints: [sprint({ boardId: 'ACC' })],
      membership: new Map([['S1', membershipWith(['ACC-2'])]]),
    })

    const result = await service.getHealthcheck('2026-W30')
    // ACC-1 (support), ACC-2 (planned), PLAT-1 (kanban denominator only) → 3 rows.
    expect(result.tickets).toHaveLength(3)
    const byKey = Object.fromEntries(result.tickets.map((t) => [t.key, t]))
    expect(byKey['ACC-1']).toMatchObject({ boardId: 'ACC', support: true, planned: false })
    expect(byKey['ACC-2']).toMatchObject({ boardId: 'ACC', planned: true })
    expect(byKey['PLAT-1']).toMatchObject({ boardId: 'PLAT', boardType: 'kanban', planned: false, onRoadmap: false })
    // JIRA_BASE_URL not configured in the mock → empty jiraUrl.
    expect(byKey['ACC-1'].jiraUrl).toBe('')
    // Sorted by board then key.
    expect(result.tickets.map((t) => t.key)).toEqual(['ACC-1', 'ACC-2', 'PLAT-1'])
  })
});

// ---------------------------------------------------------------------------
// Reproducibility: stored weeks, explicit live view, drift (ADR 0092)
//
// 2026-W30 is a completed week, so it is storable. The current week never is.
// ---------------------------------------------------------------------------

describe('HealthcheckService — stored vs live (ADR 0092)', () => {
  function baseMocks(): Mocks {
    return {
      configs: [config()],
      issues: [issue({ key: 'ACC-1' }), issue({ key: 'ACC-2' })],
      changelogs: [
        statusLog('ACC-1', 'In Progress', IN_WEEK),
        statusLog('ACC-2', 'In Progress', IN_WEEK),
      ],
      sprints: [sprint()],
      membership: new Map([['S1', membershipWith(['ACC-1'])]]),
      snapshots: [],
    };
  }

  it('writes through on the first read of a completed week and serves it as stored', async () => {
    const mocks = baseMocks();
    const service = await buildService(mocks);

    const first = await service.getHealthcheck('2026-W30');
    expect(first.source).toBe('stored');
    expect(mocks.snapshots).toHaveLength(1);
    expect(mocks.snapshots![0].week).toBe('2026-W30');
    expect(mocks.snapshots![0].configHash).toBe(first.configHash);
  });

  it('returns a stable computedAt across repeated reads of a completed week', async () => {
    const mocks = baseMocks();
    const service = await buildService(mocks);

    const first = await service.getHealthcheck('2026-W30');
    const second = await service.getHealthcheck('2026-W30');

    expect(second.source).toBe('stored');
    expect(second.computedAt).toBe(first.computedAt);
    expect(second.stability).toEqual(first.stability);
    expect(second.tickets.map((t) => t.key)).toEqual(first.tickets.map((t) => t.key));
    // Still exactly one row — a read never duplicates the stored figure.
    expect(mocks.snapshots).toHaveLength(1);
  });

  it('serves the stored figure even when the underlying data has since changed', async () => {
    // This is the property the W35 investigation was missing: a closed week's
    // published figure must not move under a caller's feet.
    const mocks = baseMocks();
    const service = await buildService(mocks);
    const stored = await service.getHealthcheck('2026-W30');
    expect(stored.stability.denominator).toBe(2);

    // A third ticket retroactively appears in the week (e.g. it was only just
    // added to a sprint, so the sync had never fetched it before).
    mocks.issues.push(issue({ key: 'ACC-3' }));
    mocks.changelogs.push(statusLog('ACC-3', 'In Progress', IN_WEEK));

    const again = await service.getHealthcheck('2026-W30');
    expect(again.source).toBe('stored');
    expect(again.stability.denominator).toBe(2);
    expect(again.computedAt).toBe(stored.computedAt);
  });

  it('view=live recomputes and reports drift instead of overwriting the stored figure', async () => {
    const mocks = baseMocks();
    const service = await buildService(mocks);
    const stored = await service.getHealthcheck('2026-W30');

    mocks.issues.push(issue({ key: 'ACC-3' }));
    mocks.changelogs.push(statusLog('ACC-3', 'In Progress', IN_WEEK));

    const live = await service.getHealthcheck('2026-W30', true, 'live');
    expect(live.source).toBe('live');
    expect(live.stability.denominator).toBe(3);
    expect(live.drift).not.toBeNull();
    expect(live.drift!.hasDrift).toBe(true);
    expect(live.drift!.ticketsAdded).toEqual(['ACC-3']);
    expect(live.drift!.stability.stored.denominator).toBe(2);
    expect(live.drift!.stability.live.denominator).toBe(3);

    // The stored row is untouched — the evidence of the discrepancy survives.
    expect(mocks.snapshots).toHaveLength(1);
    const after = await service.getHealthcheck('2026-W30');
    expect(after.stability.denominator).toBe(2);
    expect(after.computedAt).toBe(stored.computedAt);
  });

  it('view=live reports drift=null when there is no stored figure to compare', async () => {
    const service = await buildService(baseMocks());
    const live = await service.getHealthcheck('2026-W30', true, 'live');
    expect(live.source).toBe('live');
    expect(live.drift).toBeNull();
  });

  it('never stores or reads a snapshot for includeSupport=false', async () => {
    // includeSupport=false changes the Stability/Roadmap denominator AND
    // numerator, so it is an exploratory re-slice, not the canonical figure.
    const mocks = baseMocks();
    const service = await buildService(mocks);

    const result = await service.getHealthcheck('2026-W30', false);
    expect(result.source).toBe('live');
    expect(result.includeSupport).toBe(false);
    expect(result.drift).toBeNull();
    expect(mocks.snapshots).toHaveLength(0);
  });

  it('echoes includeSupport so two views are distinguishable in the payload', async () => {
    const service = await buildService(baseMocks());
    expect((await service.getHealthcheck('2026-W30')).includeSupport).toBe(true);
    expect((await service.getHealthcheck('2026-W30', false)).includeSupport).toBe(false);
  });

  it('never stores the current week and always reports it as live', async () => {
    const mocks = baseMocks();
    const service = await buildService(mocks);
    // TIMEZONE resolves to the ConfigService default ('UTC') in these mocks.
    const now = new Date();
    const thursday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const year = thursday.getUTCFullYear();
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const week = String(
      1 +
        Math.round(
          ((thursday.getTime() - jan4.getTime()) / 86400000 -
            3 +
            ((jan4.getUTCDay() + 6) % 7)) /
            7,
        ),
    ).padStart(2, '0');

    const result = await service.getHealthcheck(`${year}-W${week}`);
    expect(result.source).toBe('live');
    expect(mocks.snapshots).toHaveLength(0);
  });

  it('carries a configHash on every response', async () => {
    const service = await buildService(baseMocks());
    const result = await service.getHealthcheck('2026-W30');
    expect(result.configHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exposes each ticket derived first_start so the derivation is auditable', async () => {
    const service = await buildService(baseMocks());
    const result = await service.getHealthcheck('2026-W30');
    expect(result.tickets.map((t) => t.firstStart)).toEqual([
      IN_WEEK.toISOString(),
      IN_WEEK.toISOString(),
    ]);
  });

  it('takes each trend point from that week own stored figure, not a fresh recompute', async () => {
    // Otherwise the stored payload embeds a trend computed at freeze time, and
    // week W's trend point for W-3 can disagree with W-3's own stored figure —
    // the chart and the score cards would show different numbers for the same
    // week.
    const mocks = baseMocks();
    const service = await buildService(mocks);

    // Freeze W29 with a denominator of 2 (ACC-1, ACC-2 both started that week).
    mocks.changelogs = [
      statusLog('ACC-1', 'In Progress', new Date('2026-07-14T10:00:00Z')),
      statusLog('ACC-2', 'In Progress', new Date('2026-07-14T10:00:00Z')),
    ];
    const w29 = await service.getHealthcheck('2026-W29');
    expect(w29.source).toBe('stored');

    // Now the data changes, then W30 is read for the first time. Its trend must
    // report W29 exactly as W29 was stored, not as it looks now.
    mocks.issues.push(issue({ key: 'ACC-3' }));
    mocks.changelogs.push(statusLog('ACC-3', 'In Progress', new Date('2026-07-14T10:00:00Z')));

    const w30 = await service.getHealthcheck('2026-W30');
    const w29Point = w30.trend.find((t) => t.week === '2026-W29');
    expect(w29Point?.stability).toBe(w29.stability.score);
  });

  it('recomputes every trend point on the live view so drift is apples-to-apples', async () => {
    // Support is used here because it needs no sprint window to be meaningful.
    const mocks: Mocks = {
      configs: [config({ supportLabels: ['support'] })],
      issues: [issue({ key: 'ACC-1', labels: ['support'] })],
      changelogs: [statusLog('ACC-1', 'In Progress', new Date('2026-07-14T10:00:00Z'))],
      sprints: [sprint()],
      membership: new Map(),
      snapshots: [],
    };
    const service = await buildService(mocks);

    const w29 = await service.getHealthcheck('2026-W29'); // freeze: support 1/1
    expect(w29.support.score).toBe(100);

    // A second, non-support ticket appears in W29.
    mocks.issues.push(issue({ key: 'ACC-2' }));
    mocks.changelogs.push(statusLog('ACC-2', 'In Progress', new Date('2026-07-14T10:00:00Z')));

    // Stored view still reports the frozen figure for W29...
    const stored = await service.getHealthcheck('2026-W30');
    expect(stored.trend.find((t) => t.week === '2026-W29')?.support).toBe(100);

    // ...while the live view reflects current data (1 of 2 = 50).
    const live = await service.getHealthcheck('2026-W30', true, 'live');
    expect(live.trend.find((t) => t.week === '2026-W29')?.support).toBe(50);
  });
});

describe('HealthcheckService — mirror integrity warning', () => {
  it('warns when an issue sits in a transitioned status but has no stored history', async () => {
    // This is the shape of a shrunken denominator: the ticket reached Done, so
    // it must have transitioned, yet no status changelog is stored. It silently
    // contributes to no week at all.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const service = await buildService({
        configs: [config()],
        issues: [
          issue({ key: 'ACC-1', status: 'Done' }), // no changelog → suspect
          issue({ key: 'ACC-2', status: 'In Progress' }), // has changelog → fine
        ],
        changelogs: [statusLog('ACC-2', 'In Progress', IN_WEEK)],
        sprints: [sprint()],
        membership: new Map([['S1', membershipWith([])]]),
      });
      await service.getHealthcheck('2026-W30');

      const messages = warn.mock.calls.map((c) => String(c[0]));
      const hit = messages.find((m) => m.includes('NO stored status changelog'));
      expect(hit).toBeDefined();
      expect(hit).toContain('ACC-1');
      expect(hit).not.toContain('ACC-2');
    } finally {
      warn.mockRestore();
    }
  });

  it('stays quiet when every transitioned issue has stored history', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const service = await buildService({
        configs: [config()],
        issues: [issue({ key: 'ACC-1', status: 'In Progress' })],
        changelogs: [statusLog('ACC-1', 'In Progress', IN_WEEK)],
        sprints: [sprint()],
        membership: new Map([['S1', membershipWith([])]]),
      });
      await service.getHealthcheck('2026-W30');

      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('NO stored status changelog'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not flag an issue still sitting in its initial status', async () => {
    // "To Do" with no changelog is completely normal — never started.
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    try {
      const service = await buildService({
        configs: [config()],
        issues: [issue({ key: 'ACC-1', status: 'To Do' })],
        changelogs: [],
        sprints: [sprint()],
        membership: new Map([['S1', membershipWith([])]]),
      });
      await service.getHealthcheck('2026-W30');

      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.some((m) => m.includes('NO stored status changelog'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
