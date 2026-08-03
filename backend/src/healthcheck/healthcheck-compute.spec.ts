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
    expect(result.stability.score).toBe(50);
  });

  it('is N/A (null) for kanban boards', () => {
    const result = computeBoardHealthcheck(
      baseInput({
        boardType: 'kanban',
        issues,
        statusChangelogsByIssue: logs,
      }),
    );
    expect(result.stability.score).toBeNull();
    expect(result.stability.numerator).toBeNull();
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
    expect(result.roadmap.score).toBe(50);
  });

  it('is N/A (null) for kanban boards', () => {
    const result = computeBoardHealthcheck(
      baseInput({ boardType: 'kanban', issues, statusChangelogsByIssue: logs }),
    );
    expect(result.roadmap.score).toBeNull();
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
    expect(result.support.score).toBe(50);
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
    expect(result.support.score).toBe(100);
    expect(result.stability.score).toBeNull();
    expect(result.roadmap.score).toBeNull();
  });
});

describe('computeBoardHealthcheck — empty denominator', () => {
  it('reports all three dimensions as N/A when nothing started this week', () => {
    const result = computeBoardHealthcheck(baseInput({ issues: [], statusChangelogsByIssue: new Map() }));
    expect(result.denominator).toBe(0);
    expect(result.stability.score).toBeNull();
    expect(result.roadmap.score).toBeNull();
    expect(result.support.score).toBeNull();
  });
});
