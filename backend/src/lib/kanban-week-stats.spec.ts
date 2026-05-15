/**
 * Tests for kanban-week-stats helper.
 *
 * Pure unit tests — no NestJS, no TypeORM, no external dependencies.
 */

import {
  buildKanbanBoardEntryDateMap,
  filterKanbanIssues,
  getKanbanPulledIn,
  getKanbanCompletedThisWeek,
  getKanbanInFlight,
} from './kanban-week-stats.js';
import type { JiraIssue, JiraChangelog } from '../database/entities/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WEEK_START = new Date('2026-05-11T00:00:00.000Z'); // Mon W20
const WEEK_END   = new Date('2026-05-17T23:59:59.999Z'); // Sun W20

const BOARD_ENTRY_STATUSES = new Set([
  'to do', 'backlog', 'open', 'new', 'todo', 'open', 'selected for development',
]);

const DONE_STATUSES = new Set(['done', 'released']);

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'PLAT-1',
    boardId: 'PLAT',
    issueType: 'Story',
    summary: 'Test',
    status: 'In Progress',
    statusId: null,
    labels: [],
    epicKey: null,
    fixVersion: null,
    sprintId: null,
    points: null,
    priority: null,
    assignee: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as unknown as JiraIssue;
}

function makeCl(overrides: Partial<JiraChangelog> = {}): JiraChangelog {
  return {
    id: 1,
    issueKey: 'PLAT-1',
    field: 'status',
    fromValue: null,
    toValue: 'To Do',
    fromId: null,
    toId: null,
    changedAt: WEEK_START,
    ...overrides,
  } as unknown as JiraChangelog;
}

// ---------------------------------------------------------------------------
// buildKanbanBoardEntryDateMap
// ---------------------------------------------------------------------------

describe('buildKanbanBoardEntryDateMap', () => {
  it('returns first transition to a boardEntryStatus as the board-entry date', () => {
    const issue = makeIssue({ key: 'PLAT-1' });
    const cls = [
      makeCl({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') }),
      makeCl({ issueKey: 'PLAT-1', toValue: 'In Progress', changedAt: new Date('2026-05-13T09:00:00Z') }),
    ];
    const clsByIssue = new Map([['PLAT-1', cls]]);

    const result = buildKanbanBoardEntryDateMap([issue], clsByIssue, BOARD_ENTRY_STATUSES);

    expect(result.get('PLAT-1')).toEqual(new Date('2026-05-12T08:00:00Z'));
  });

  it('falls back to issue.createdAt when no boardEntryStatus transition exists', () => {
    const created = new Date('2026-03-01T00:00:00Z');
    const issue = makeIssue({ key: 'PLAT-1', createdAt: created });
    const clsByIssue = new Map<string, JiraChangelog[]>([['PLAT-1', []]]);

    const result = buildKanbanBoardEntryDateMap([issue], clsByIssue, BOARD_ENTRY_STATUSES);

    expect(result.get('PLAT-1')).toEqual(created);
  });

  it('is case-insensitive for boardEntryStatuses matching', () => {
    const issue = makeIssue({ key: 'PLAT-1' });
    const cls = [makeCl({ issueKey: 'PLAT-1', toValue: 'BACKLOG', changedAt: new Date('2026-05-12T08:00:00Z') })];
    const clsByIssue = new Map([['PLAT-1', cls]]);

    const result = buildKanbanBoardEntryDateMap([issue], clsByIssue, BOARD_ENTRY_STATUSES);

    expect(result.get('PLAT-1')).toEqual(new Date('2026-05-12T08:00:00Z'));
  });

  it('uses first matching transition, not the latest', () => {
    const issue = makeIssue({ key: 'PLAT-1' });
    const cls = [
      // Issue bounced: To Do → In Progress → To Do again
      makeCl({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2026-04-01T08:00:00Z') }),
      makeCl({ issueKey: 'PLAT-1', toValue: 'In Progress', changedAt: new Date('2026-04-02T09:00:00Z') }),
      makeCl({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2026-04-10T09:00:00Z') }),
    ];
    const clsByIssue = new Map([['PLAT-1', cls]]);

    const result = buildKanbanBoardEntryDateMap([issue], clsByIssue, BOARD_ENTRY_STATUSES);

    // Must use first occurrence, not the re-entry date
    expect(result.get('PLAT-1')).toEqual(new Date('2026-04-01T08:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// filterKanbanIssues
// ---------------------------------------------------------------------------

describe('filterKanbanIssues', () => {
  it('excludes issues whose statusId is in backlogStatusIds', () => {
    const active = makeIssue({ key: 'PLAT-1', statusId: null });
    const backlog = makeIssue({ key: 'PLAT-2', statusId: '10303' });
    const clsByIssue = new Map<string, JiraChangelog[]>([
      ['PLAT-1', [makeCl({ issueKey: 'PLAT-1' })]],
      ['PLAT-2', [makeCl({ issueKey: 'PLAT-2' })]],
    ]);
    const boardEntryDateByKey = new Map([
      ['PLAT-1', new Date('2026-05-12T00:00:00Z')],
      ['PLAT-2', new Date('2026-05-12T00:00:00Z')],
    ]);

    const result = filterKanbanIssues({
      issues: [active, backlog],
      backlogStatusIds: ['10303'],
      issueKeysWithStatusChangelog: new Set(['PLAT-1', 'PLAT-2']),
      dataStartBound: null,
      boardEntryDateByKey,
    });

    expect(result.map(i => i.key)).toEqual(['PLAT-1']);
  });

  it('excludes issues with no status changelog when backlogStatusIds is empty', () => {
    const withCl = makeIssue({ key: 'PLAT-1' });
    const noCl = makeIssue({ key: 'PLAT-2' });
    const boardEntryDateByKey = new Map([
      ['PLAT-1', new Date('2026-05-12T00:00:00Z')],
      ['PLAT-2', new Date('2026-01-01T00:00:00Z')],
    ]);

    const result = filterKanbanIssues({
      issues: [withCl, noCl],
      backlogStatusIds: [],
      issueKeysWithStatusChangelog: new Set(['PLAT-1']), // PLAT-2 has no changelog
      dataStartBound: null,
      boardEntryDateByKey,
    });

    expect(result.map(i => i.key)).toEqual(['PLAT-1']);
  });

  it('excludes issues whose board-entry date is before dataStartBound', () => {
    const newIssue = makeIssue({ key: 'PLAT-1' });
    const oldIssue = makeIssue({ key: 'PLAT-2' });
    const boardEntryDateByKey = new Map([
      ['PLAT-1', new Date('2025-06-01T00:00:00Z')], // after bound
      ['PLAT-2', new Date('2023-12-01T00:00:00Z')], // before bound
    ]);

    const result = filterKanbanIssues({
      issues: [newIssue, oldIssue],
      backlogStatusIds: [],
      issueKeysWithStatusChangelog: new Set(['PLAT-1', 'PLAT-2']),
      dataStartBound: new Date('2024-01-01'),
      boardEntryDateByKey,
    });

    expect(result.map(i => i.key)).toEqual(['PLAT-1']);
  });

  it('includes all issues when backlogStatusIds is empty and all have changelogs', () => {
    const issues = [makeIssue({ key: 'PLAT-1' }), makeIssue({ key: 'PLAT-2' })];
    const boardEntryDateByKey = new Map([
      ['PLAT-1', new Date('2026-05-12T00:00:00Z')],
      ['PLAT-2', new Date('2026-05-12T00:00:00Z')],
    ]);

    const result = filterKanbanIssues({
      issues,
      backlogStatusIds: [],
      issueKeysWithStatusChangelog: new Set(['PLAT-1', 'PLAT-2']),
      dataStartBound: null,
      boardEntryDateByKey,
    });

    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getKanbanPulledIn
// ---------------------------------------------------------------------------

describe('getKanbanPulledIn', () => {
  it('returns only issues whose board-entry date is within the week window', () => {
    const inWeek = makeIssue({ key: 'PLAT-1' });
    const priorWeek = makeIssue({ key: 'PLAT-2' });
    const boardEntryDateByKey = new Map([
      ['PLAT-1', new Date('2026-05-12T08:00:00Z')], // W20
      ['PLAT-2', new Date('2026-05-04T08:00:00Z')], // W19
    ]);

    const result = getKanbanPulledIn([inWeek, priorWeek], boardEntryDateByKey, WEEK_START, WEEK_END);

    expect(result.map(i => i.key)).toEqual(['PLAT-1']);
  });

  it('excludes cancelled issues (current status in cancelledStatuses)', () => {
    const active = makeIssue({ key: 'PLAT-1', status: 'In Progress' });
    const cancelled = makeIssue({ key: 'PLAT-2', status: 'Cancelled' });
    const boardEntryDateByKey = new Map([
      ['PLAT-1', new Date('2026-05-12T08:00:00Z')],
      ['PLAT-2', new Date('2026-05-12T08:00:00Z')],
    ]);

    const result = getKanbanPulledIn(
      [active, cancelled],
      boardEntryDateByKey,
      WEEK_START,
      WEEK_END,
      new Set(['cancelled', "won't do"]),
    );

    expect(result.map(i => i.key)).toEqual(['PLAT-1']);
  });
});

// ---------------------------------------------------------------------------
// getKanbanCompletedThisWeek
// ---------------------------------------------------------------------------

describe('getKanbanCompletedThisWeek', () => {
  it('returns issues with a done-transition within the week, regardless of when they entered', () => {
    const enteredThisWeek = makeIssue({ key: 'PLAT-1' });
    const enteredPriorWeek = makeIssue({ key: 'PLAT-2' });
    const clsByIssue = new Map([
      ['PLAT-1', [
        makeCl({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') }),
        makeCl({ issueKey: 'PLAT-1', toValue: 'Done', changedAt: new Date('2026-05-14T15:00:00Z') }),
      ]],
      ['PLAT-2', [
        makeCl({ issueKey: 'PLAT-2', toValue: 'To Do', changedAt: new Date('2026-04-01T08:00:00Z') }),
        makeCl({ issueKey: 'PLAT-2', toValue: 'Done', changedAt: new Date('2026-05-13T10:00:00Z') }),
      ]],
    ]);

    const result = getKanbanCompletedThisWeek(
      [enteredThisWeek, enteredPriorWeek],
      clsByIssue,
      DONE_STATUSES,
      WEEK_START,
      WEEK_END,
    );

    expect(result.map(i => i.key)).toContain('PLAT-1');
    expect(result.map(i => i.key)).toContain('PLAT-2');
  });

  it('excludes issues with no done-transition in the week window', () => {
    const issue = makeIssue({ key: 'PLAT-1' });
    const clsByIssue = new Map([
      ['PLAT-1', [
        makeCl({ issueKey: 'PLAT-1', toValue: 'To Do', changedAt: new Date('2026-05-12T08:00:00Z') }),
        // No done transition
      ]],
    ]);

    const result = getKanbanCompletedThisWeek(
      [issue],
      clsByIssue,
      DONE_STATUSES,
      WEEK_START,
      WEEK_END,
    );

    expect(result).toHaveLength(0);
  });

  it('excludes issues whose done-transition is outside the week window', () => {
    const issue = makeIssue({ key: 'PLAT-1' });
    const clsByIssue = new Map([
      ['PLAT-1', [
        makeCl({ issueKey: 'PLAT-1', toValue: 'Done', changedAt: new Date('2026-05-10T15:00:00Z') }), // W19
      ]],
    ]);

    const result = getKanbanCompletedThisWeek(
      [issue],
      clsByIssue,
      DONE_STATUSES,
      WEEK_START,
      WEEK_END,
    );

    expect(result).toHaveLength(0);
  });

  it('is case-insensitive for doneStatuses matching', () => {
    const issue = makeIssue({ key: 'PLAT-1' });
    const clsByIssue = new Map([
      ['PLAT-1', [
        makeCl({ issueKey: 'PLAT-1', toValue: 'DONE', changedAt: new Date('2026-05-14T15:00:00Z') }),
      ]],
    ]);

    const result = getKanbanCompletedThisWeek(
      [issue],
      clsByIssue,
      DONE_STATUSES, // contains 'done' lowercase
      WEEK_START,
      WEEK_END,
    );

    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getKanbanInFlight
// ---------------------------------------------------------------------------

describe('getKanbanInFlight', () => {
  it('returns issues that are not in a done or cancelled status', () => {
    const active = makeIssue({ key: 'PLAT-1', status: 'In Progress' });
    const done   = makeIssue({ key: 'PLAT-2', status: 'Done' });
    const cancelled = makeIssue({ key: 'PLAT-3', status: 'Cancelled' });
    const todo   = makeIssue({ key: 'PLAT-4', status: 'To Do' });

    const result = getKanbanInFlight(
      [active, done, cancelled, todo],
      DONE_STATUSES,
      new Set(['cancelled']),
    );

    expect(result.map(i => i.key)).toEqual(['PLAT-1', 'PLAT-4']);
  });

  it('is case-insensitive for status matching', () => {
    const issue = makeIssue({ key: 'PLAT-1', status: 'DONE' });

    const result = getKanbanInFlight(
      [issue],
      DONE_STATUSES, // contains 'done' lowercase
      new Set(['cancelled']),
    );

    expect(result).toHaveLength(0);
  });

  it('returns empty array when all issues are done or cancelled', () => {
    const issues = [
      makeIssue({ key: 'PLAT-1', status: 'Done' }),
      makeIssue({ key: 'PLAT-2', status: 'Released' }),
      makeIssue({ key: 'PLAT-3', status: 'Cancelled' }),
    ];

    const result = getKanbanInFlight(
      issues,
      new Set(['done', 'released']),
      new Set(['cancelled']),
    );

    expect(result).toHaveLength(0);
  });

  it('returns all issues when none are done or cancelled', () => {
    const issues = [
      makeIssue({ key: 'PLAT-1', status: 'To Do' }),
      makeIssue({ key: 'PLAT-2', status: 'In Progress' }),
      makeIssue({ key: 'PLAT-3', status: 'In Review' }),
    ];

    const result = getKanbanInFlight(
      issues,
      DONE_STATUSES,
      new Set(['cancelled']),
    );

    expect(result).toHaveLength(3);
  });
});
