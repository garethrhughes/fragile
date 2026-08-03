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

describe('computeBoardHealthcheck — empty denominator', () => {
  it('reports a zero denominator for all dimensions when nothing started this week', () => {
    const result = computeBoardHealthcheck(baseInput({ issues: [], statusChangelogsByIssue: new Map() }));
    expect(result.denominator).toBe(0);
    expect(result.stability.denominator).toBe(0);
    expect(result.roadmap.denominator).toBe(0);
    expect(result.support.denominator).toBe(0);
  });
});
