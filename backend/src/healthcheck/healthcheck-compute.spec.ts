import { describe, it, expect } from '@jest/globals';
import { computeBoardHealthcheck, type BoardHealthcheckInput } from './healthcheck-compute.js';
import type { JiraIssue, JiraChangelog } from '../database/entities/index.js';

// --- Test builders ---------------------------------------------------------

function issue(partial: Partial<JiraIssue> & { key: string }): JiraIssue {
  return {
    summary: partial.summary ?? partial.key,
    issueType: partial.issueType ?? 'Story',
    status: partial.status ?? 'In Progress',
    epicKey: partial.epicKey ?? null,
    labels: partial.labels ?? [],
    createdAt: partial.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    ...partial,
  } as JiraIssue;
}

function statusLog(issueKey: string, toValue: string, changedAt: string): JiraChangelog {
  return { issueKey, field: 'status', toValue, changedAt: new Date(changedAt) } as JiraChangelog;
}

const WEEK = '2026-W30';
// Mon 2026-07-20 .. Sun 2026-07-26 (UTC for test determinism)
const weekStart = new Date('2026-07-20T00:00:00Z');
const weekEnd = new Date('2026-07-26T23:59:59.999Z');

function baseInput(overrides: Partial<BoardHealthcheckInput>): BoardHealthcheckInput {
  return {
    boardId: 'ACC',
    boardType: 'scrum',
    week: WEEK,
    weekStart,
    weekEnd,
    issues: [],
    statusChangelogsByIssue: new Map(),
    inProgressStatuses: new Set(['In Progress']),
    boardEntryStatuses: new Set(['to do', 'backlog']),
    doneStatusNames: ['Done'],
    cancelledStatuses: new Set(['cancelled']),
    committedKeysAt: () => false,
    isRoadmapLinked: () => false,
    supportConfig: { supportEpics: [], supportLabels: [], supportLinkTypes: [], triageBoardKey: null },
    linksByIssue: new Map(),
    ...overrides,
  };
}

describe('computeBoardHealthcheck — denominator (scrum)', () => {
  it('counts tickets whose FIRST-EVER in-progress transition falls in the week', () => {
    const issues = [issue({ key: 'ACC-1' }), issue({ key: 'ACC-2' }), issue({ key: 'ACC-3' })];
    const logs = new Map<string, JiraChangelog[]>([
      // ACC-1: first in-progress inside the week → counts
      ['ACC-1', [statusLog('ACC-1', 'In Progress', '2026-07-21T10:00:00Z')]],
      // ACC-2: first in-progress BEFORE the week (still in progress) → excluded
      ['ACC-2', [statusLog('ACC-2', 'In Progress', '2026-07-10T10:00:00Z')]],
      // ACC-3: never moved to in-progress → excluded
      ['ACC-3', []],
    ]);
    const result = computeBoardHealthcheck(
      baseInput({ issues, statusChangelogsByIssue: logs }),
    );
    expect(result.denominator).toBe(1);
  });

  it('uses the FIRST in-progress transition even when a later one lands in the week', () => {
    const issues = [issue({ key: 'ACC-1' })];
    const logs = new Map<string, JiraChangelog[]>([
      [
        'ACC-1',
        [
          statusLog('ACC-1', 'In Progress', '2026-07-01T10:00:00Z'), // first, before week
          statusLog('ACC-1', 'To Do', '2026-07-05T10:00:00Z'),
          statusLog('ACC-1', 'In Progress', '2026-07-22T10:00:00Z'), // re-entry, in week
        ],
      ],
    ]);
    const result = computeBoardHealthcheck(baseInput({ issues, statusChangelogsByIssue: logs }));
    expect(result.denominator).toBe(0);
  });
});

describe('computeBoardHealthcheck — kanban denominator (board-entry, with createdAt fallback)', () => {
  it('counts a kanban ticket whose first board-entry transition falls in the week', () => {
    const issues = [issue({ key: 'PLAT-1', boardId: 'PLAT' })];
    const logs = new Map<string, JiraChangelog[]>([
      ['PLAT-1', [statusLog('PLAT-1', 'To Do', '2026-07-21T09:00:00Z')]],
    ]);
    const result = computeBoardHealthcheck(
      baseInput({ boardId: 'PLAT', boardType: 'kanban', issues, statusChangelogsByIssue: logs }),
    );
    expect(result.denominator).toBe(1);
  });

  it('falls back to createdAt for a kanban ticket created directly on the board (no board-entry transition)', () => {
    // PLAT ticket created in-week with NO status changelog into a board-entry status.
    const issues = [
      issue({ key: 'PLAT-1', boardId: 'PLAT', createdAt: new Date('2026-07-22T08:00:00Z') }),
    ];
    const result = computeBoardHealthcheck(
      baseInput({
        boardId: 'PLAT',
        boardType: 'kanban',
        issues,
        statusChangelogsByIssue: new Map(), // no changelog at all
      }),
    );
    expect(result.denominator).toBe(1);
    expect(result.tickets.map((t) => t.key)).toEqual(['PLAT-1']);
  });

  it('excludes a kanban ticket created before the week when it has no board-entry transition', () => {
    const issues = [
      issue({ key: 'PLAT-1', boardId: 'PLAT', createdAt: new Date('2026-07-10T08:00:00Z') }),
    ];
    const result = computeBoardHealthcheck(
      baseInput({
        boardId: 'PLAT',
        boardType: 'kanban',
        issues,
        statusChangelogsByIssue: new Map(),
      }),
    );
    expect(result.denominator).toBe(0);
  });

  it('does NOT fall back to createdAt for scrum tickets (in-progress transition required)', () => {
    const issues = [
      issue({ key: 'ACC-1', createdAt: new Date('2026-07-22T08:00:00Z') }),
    ];
    const result = computeBoardHealthcheck(
      baseInput({ issues, statusChangelogsByIssue: new Map() }),
    );
    expect(result.denominator).toBe(0);
  });
});

describe('computeBoardHealthcheck — stability (scrum only)', () => {
  const issues = [issue({ key: 'ACC-1' }), issue({ key: 'ACC-2' })];
  const logs = new Map<string, JiraChangelog[]>([
    ['ACC-1', [statusLog('ACC-1', 'In Progress', '2026-07-21T10:00:00Z')]],
    ['ACC-2', [statusLog('ACC-2', 'In Progress', '2026-07-22T10:00:00Z')]],
  ]);

  it('numerator counts started tickets that were committed/carry-over at their sprint start', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        // ACC-1 committed against the sprint active at its in-progress moment; ACC-2 not.
        committedKeysAt: (key) => key === 'ACC-1',
      }),
    );
    expect(result.denominator).toBe(2);
    expect(result.stability.numerator).toBe(1);
    expect(result.stability.denominator).toBe(2);
    expect(result.stability.applicable).toBe(true);
  });

  it('is not applicable for kanban boards', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        boardType: 'kanban',
        issues,
        statusChangelogsByIssue: logs,
      }),
    );
    expect(result.stability.applicable).toBe(false);
  });
});

describe('computeBoardHealthcheck — roadmap (scrum only)', () => {
  const issues = [issue({ key: 'ACC-1' }), issue({ key: 'ACC-2' })];
  const logs = new Map<string, JiraChangelog[]>([
    ['ACC-1', [statusLog('ACC-1', 'In Progress', '2026-07-21T10:00:00Z')]],
    ['ACC-2', [statusLog('ACC-2', 'In Progress', '2026-07-22T10:00:00Z')]],
  ]);

  it('numerator counts started tickets that are roadmap-linked (membership, not delivery)', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        isRoadmapLinked: (key) => key === 'ACC-1',
      }),
    );
    expect(result.roadmap.numerator).toBe(1);
    expect(result.roadmap.denominator).toBe(2);
    expect(result.roadmap.applicable).toBe(true);
  });

  it('is not applicable for kanban boards', () => {
    const result = computeBoardHealthcheck(
      baseInput({ boardType: 'kanban', issues, statusChangelogsByIssue: logs }),
    );
    expect(result.roadmap.applicable).toBe(false);
  });
});

describe('computeBoardHealthcheck — support (all boards)', () => {
  it('numerator counts started tickets classified as support', () => {
    const issues = [
      issue({ key: 'ACC-1', labels: ['support'] }),
      issue({ key: 'ACC-2', labels: [] }),
    ];
    const logs = new Map<string, JiraChangelog[]>([
      ['ACC-1', [statusLog('ACC-1', 'In Progress', '2026-07-21T10:00:00Z')]],
      ['ACC-2', [statusLog('ACC-2', 'In Progress', '2026-07-22T10:00:00Z')]],
    ]);
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        supportConfig: { supportEpics: [], supportLabels: ['support'], supportLinkTypes: [], triageBoardKey: null },
      }),
    );
    expect(result.support.numerator).toBe(1);
    expect(result.support.denominator).toBe(2);
    expect(result.support.applicable).toBe(true);
  });

  it('computes support for kanban boards using board-entry as the start signal', () => {
    const issues = [issue({ key: 'PLAT-1', labels: ['support'], status: 'In Progress' })];
    const logs = new Map<string, JiraChangelog[]>([
      // board-entry (to do) within the week is the kanban "start"
      ['PLAT-1', [statusLog('PLAT-1', 'To Do', '2026-07-21T09:00:00Z')]],
    ]);
    const result = computeBoardHealthcheck(
      baseInput({
        boardId: 'PLAT',
        boardType: 'kanban',
        issues,
        statusChangelogsByIssue: logs,
        supportConfig: { supportEpics: [], supportLabels: ['support'], supportLinkTypes: [], triageBoardKey: null },
      }),
    );
    expect(result.denominator).toBe(1);
    expect(result.support.numerator).toBe(1);
    expect(result.support.applicable).toBe(true);
    expect(result.stability.applicable).toBe(false);
    expect(result.roadmap.applicable).toBe(false);
  });
});

describe('computeBoardHealthcheck — tickets', () => {
  it('returns one ticket row per started ticket, flagged by dimension', () => {
    const issues = [
      issue({ key: 'ACC-1', summary: 'Planned + roadmap', issueType: 'Story', status: 'In Progress', labels: [] }),
      issue({ key: 'ACC-2', summary: 'Support only', issueType: 'Bug', status: 'In Progress', labels: ['support'] }),
    ];
    const logs = new Map<string, JiraChangelog[]>([
      ['ACC-1', [statusLog('ACC-1', 'In Progress', '2026-07-21T10:00:00Z')]],
      ['ACC-2', [statusLog('ACC-2', 'In Progress', '2026-07-22T10:00:00Z')]],
    ]);
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        committedKeysAt: (key) => key === 'ACC-1',
        isRoadmapLinked: (key) => key === 'ACC-1',
        supportConfig: { supportEpics: [], supportLabels: ['support'], supportLinkTypes: [], triageBoardKey: null },
      }),
    );
    expect(result.tickets).toHaveLength(2);

    const acc1 = result.tickets.find((t) => t.key === 'ACC-1')!;
    expect(acc1).toMatchObject({
      key: 'ACC-1',
      summary: 'Planned + roadmap',
      boardId: 'ACC',
      boardType: 'scrum',
      issueType: 'Story',
      status: 'In Progress',
      planned: true,
      onRoadmap: true,
      support: false,
    });

    const acc2 = result.tickets.find((t) => t.key === 'ACC-2')!;
    expect(acc2).toMatchObject({ planned: false, onRoadmap: false, support: true });
  });

  it('never flags planned/onRoadmap for kanban tickets', () => {
    const issues = [issue({ key: 'PLAT-1', labels: ['support'] })];
    const logs = new Map<string, JiraChangelog[]>([
      ['PLAT-1', [statusLog('PLAT-1', 'To Do', '2026-07-21T09:00:00Z')]],
    ]);
    const result = computeBoardHealthcheck(
      baseInput({
        boardId: 'PLAT',
        boardType: 'kanban',
        issues,
        statusChangelogsByIssue: logs,
        committedKeysAt: () => true,
        isRoadmapLinked: () => true,
        supportConfig: { supportEpics: [], supportLabels: ['support'], supportLinkTypes: [], triageBoardKey: null },
      }),
    );
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]).toMatchObject({ planned: false, onRoadmap: false, support: true });
  });

  it('excludes tickets that did not start this week from the ticket list', () => {
    const issues = [issue({ key: 'ACC-1' })];
    const logs = new Map<string, JiraChangelog[]>([
      ['ACC-1', [statusLog('ACC-1', 'In Progress', '2026-07-10T10:00:00Z')]], // before week
    ]);
    const result = computeBoardHealthcheck(baseInput({ issues, statusChangelogsByIssue: logs }));
    expect(result.tickets).toEqual([]);
  });
});

describe('computeBoardHealthcheck — includeSupport toggle', () => {
  // ACC-1 planned+roadmap non-support; ACC-2 support-only.
  const issues = [
    issue({ key: 'ACC-1', labels: [] }),
    issue({ key: 'ACC-2', labels: ['support'] }),
  ];
  const logs = new Map<string, JiraChangelog[]>([
    ['ACC-1', [statusLog('ACC-1', 'In Progress', '2026-07-21T10:00:00Z')]],
    ['ACC-2', [statusLog('ACC-2', 'In Progress', '2026-07-22T10:00:00Z')]],
  ]);
  const supportConfig = { supportEpics: [], supportLabels: ['support'], supportLinkTypes: [], triageBoardKey: null };

  it('defaults to including support (unchanged behaviour) when includeSupport is omitted', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        committedKeysAt: (key) => key === 'ACC-1',
        isRoadmapLinked: (key) => key === 'ACC-1',
        supportConfig,
      }),
    );
    // Denominator includes the support ticket.
    expect(result.stability.denominator).toBe(2);
    expect(result.roadmap.denominator).toBe(2);
    expect(result.stability.numerator).toBe(1);
    expect(result.roadmap.numerator).toBe(1);
  });

  it('excludes support tickets from Stability & Roadmap denominator AND numerator when includeSupport=false', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        committedKeysAt: (key) => key === 'ACC-1',
        isRoadmapLinked: (key) => key === 'ACC-1',
        supportConfig,
        includeSupport: false,
      }),
    );
    // The support ticket (ACC-2) drops out of the Stability/Roadmap denominator.
    expect(result.stability.denominator).toBe(1);
    expect(result.roadmap.denominator).toBe(1);
    expect(result.stability.numerator).toBe(1);
    expect(result.roadmap.numerator).toBe(1);
  });

  it('leaves the Support dimension unaffected by includeSupport=false', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        supportConfig,
        includeSupport: false,
      }),
    );
    // Support keeps the full denominator and its own numerator.
    expect(result.support.denominator).toBe(2);
    expect(result.support.numerator).toBe(1);
  });

  it('still lists every started ticket regardless of includeSupport', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        issues,
        statusChangelogsByIssue: logs,
        supportConfig,
        includeSupport: false,
      }),
    );
    expect(result.tickets.map((t) => t.key).sort()).toEqual(['ACC-1', 'ACC-2']);
    expect(result.denominator).toBe(2);
  });
});

describe('computeBoardHealthcheck — empty denominator', () => {
  it('reports a zero denominator for all dimensions when nothing started this week', () => {
    const result = computeBoardHealthcheck(baseInput({ issues: [], statusChangelogsByIssue: new Map() }));
    expect(result.denominator).toBe(0);
    expect(result.stability.denominator).toBe(0);
    expect(result.roadmap.denominator).toBe(0);
    expect(result.support.denominator).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// first_start is a MINIMUM over an append-only history (regression, W35 report)
//
// Fixtures are real, verified Jira changelogs. Both tickets must resolve to
// 2026-W35 (Australia/Sydney Mon 24 Aug .. Sun 30 Aug ->
// 2026-08-23T14:00:00Z .. 2026-08-30T13:59:59.999Z).
//
// `first_start` is min() over an append-only history, so a closed week's
// denominator is immutable unless board membership or the predicate config
// changed. These tests pin that property, including the case where the caller
// hands the changelog over in a non-ascending order — the derivation must not
// depend on an ORDER BY in a different file.
// ---------------------------------------------------------------------------

/** 2026-W35 in Australia/Sydney, exactly as the report emits it. */
const W35_START = new Date('2026-08-23T14:00:00.000Z');
const W35_END = new Date('2026-08-30T13:59:59.999Z');

/** The production in-progress predicate is case-sensitive and includes Blocked. */
const W35_IN_PROGRESS = new Set(['In Progress', 'Blocked', 'IN TEST', 'PEER REVIEW']);

/**
 * ACC-296 — two separate entries into an in-progress status. The 27 Aug one is
 * the first ever; the 10 Sep one must not win. Verified against Jira
 * (changelog total: 38, complete).
 */
const ACC_296_LOGS: JiraChangelog[] = [
  statusLog('ACC-296', 'In Progress', '2026-08-27T02:28:36.515Z'), // first start -> W35
  statusLog('ACC-296', 'PEER REVIEW', '2026-09-02T02:01:57.189Z'),
  statusLog('ACC-296', 'IN TEST', '2026-09-02T22:51:22.838Z'),
  statusLog('ACC-296', 'To Do', '2026-09-08T04:59:51.245Z'), // rewound below threshold
  statusLog('ACC-296', 'In Progress', '2026-09-10T01:55:14.574Z'), // second start
  statusLog('ACC-296', 'IN TEST', '2026-09-10T03:29:42.872Z'),
  statusLog('ACC-296', 'Done', '2026-09-10T04:50:52.089Z'),
];

/**
 * DATA-492 — a single start, later rewound; current status is `To Do`, i.e.
 * below the start threshold. `Blocked` is in the in-progress predicate, so the
 * 7 Sep `In Progress -> Blocked` hop is also a transition INTO an in-progress
 * status — it is later than 27 Aug and must not win. Verified against Jira
 * (changelog total: 11, complete).
 */
const DATA_492_LOGS: JiraChangelog[] = [
  statusLog('DATA-492', 'In Progress', '2026-08-27T06:01:04.508Z'), // only start -> W35
  statusLog('DATA-492', 'Blocked', '2026-09-06T23:06:33.734Z'), // in-progress, but later
  statusLog('DATA-492', 'To Do', '2026-09-06T23:06:36.054Z'),
];

function w35Input(
  issues: JiraIssue[],
  logs: Map<string, JiraChangelog[]>,
): BoardHealthcheckInput {
  return baseInput({
    week: '2026-W35',
    weekStart: W35_START,
    weekEnd: W35_END,
    inProgressStatuses: W35_IN_PROGRESS,
    issues,
    statusChangelogsByIssue: logs,
  });
}

describe('computeBoardHealthcheck — first_start is a minimum (2026-W35 regression)', () => {
  it('ACC-296: picks the 27 Aug start, not the 10 Sep re-entry', () => {
    const issues = [issue({ key: 'ACC-296', boardId: 'ACC', status: 'Done' })];
    const result = computeBoardHealthcheck(
      w35Input(issues, new Map([['ACC-296', ACC_296_LOGS]])),
    );
    expect(result.tickets.map((t) => t.key)).toEqual(['ACC-296']);
    expect(result.denominator).toBe(1);
  });

  it('DATA-492: counts in W35 even though its current status is below the start threshold', () => {
    const issues = [issue({ key: 'DATA-492', boardId: 'DATA', status: 'To Do' })];
    const result = computeBoardHealthcheck(
      w35Input(issues, new Map([['DATA-492', DATA_492_LOGS]])),
    );
    expect(result.tickets.map((t) => t.key)).toEqual(['DATA-492']);
    expect(result.denominator).toBe(1);
  });

  it('DATA-492: the later In Progress -> Blocked hop does not become the first start', () => {
    // Blocked is deliberately in the in-progress predicate. The 7 Sep hop into
    // it falls in 2026-W37 — if it were selected, DATA-492 would leave W35 and
    // appear in W37 instead.
    const issues = [issue({ key: 'DATA-492', boardId: 'DATA', status: 'To Do' })];
    const w37 = computeBoardHealthcheck(
      baseInput({
        week: '2026-W37',
        weekStart: new Date('2026-09-06T14:00:00.000Z'),
        weekEnd: new Date('2026-09-13T13:59:59.999Z'),
        inProgressStatuses: W35_IN_PROGRESS,
        issues,
        statusChangelogsByIssue: new Map([['DATA-492', DATA_492_LOGS]]),
      }),
    );
    expect(w37.denominator).toBe(0);
  });

  it('resolves the earliest start regardless of the order the changelog is supplied in', () => {
    // The ascending order currently comes from an ORDER BY in
    // healthcheck.service.ts. The derivation must be a real min(), not a
    // dependency on the caller's ordering.
    const issues = [
      issue({ key: 'ACC-296', boardId: 'ACC', status: 'Done' }),
      issue({ key: 'DATA-492', boardId: 'DATA', status: 'To Do' }),
    ];
    const descending = new Map<string, JiraChangelog[]>([
      ['ACC-296', [...ACC_296_LOGS].reverse()],
      ['DATA-492', [...DATA_492_LOGS].reverse()],
    ]);
    const result = computeBoardHealthcheck(w35Input(issues, descending));
    expect(result.tickets.map((t) => t.key).sort()).toEqual(['ACC-296', 'DATA-492']);
    expect(result.denominator).toBe(2);
  });

  it('is unchanged by appending later history — the closed week is immutable', () => {
    const issues = [issue({ key: 'ACC-296', boardId: 'ACC', status: 'Done' })];
    const before = computeBoardHealthcheck(
      w35Input(issues, new Map([['ACC-296', ACC_296_LOGS.slice(0, 1)]])),
    );
    const after = computeBoardHealthcheck(
      w35Input(issues, new Map([['ACC-296', ACC_296_LOGS]])),
    );
    expect(after.denominator).toBe(before.denominator);
    expect(after.tickets.map((t) => t.key)).toEqual(before.tickets.map((t) => t.key));
  });
});
