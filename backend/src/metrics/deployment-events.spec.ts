import {
  deriveDeploymentEvents,
  type DeploymentEvent,
} from './deployment-events.js';
import type {
  JiraIssue,
  JiraVersion,
  JiraChangelog,
} from '../database/entities/index.js';

const DONE = ['Done', 'Closed', 'Released'] as const;

function makeIssue(overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    key: 'ACC-1',
    boardId: 'ACC',
    issueType: 'Story',
    fixVersion: null,
    labels: [],
    ...overrides,
  } as unknown as JiraIssue;
}

function makeVersion(overrides: Partial<JiraVersion> = {}): JiraVersion {
  return {
    id: 'v1',
    name: '1.0.0',
    projectKey: 'ACC',
    released: true,
    releaseDate: new Date('2025-02-01'),
    ...overrides,
  } as unknown as JiraVersion;
}

function makeChangelog(overrides: Partial<JiraChangelog> = {}): JiraChangelog {
  return {
    issueKey: 'ACC-1',
    field: 'status',
    fromValue: 'In Progress',
    toValue: 'Done',
    changedAt: new Date('2025-02-15'),
    ...overrides,
  } as unknown as JiraChangelog;
}

const start = new Date('2025-01-01');
const end = new Date('2025-03-31');

describe('deriveDeploymentEvents', () => {
  it('returns no events for empty inputs', () => {
    const result = deriveDeploymentEvents({
      issues: [],
      versions: [],
      changelogs: [],
      doneStatuses: [...DONE],
      startDate: start,
      endDate: end,
    });

    expect(result.events).toEqual([]);
    expect(result.deployedIssueKeys.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Primary path: fixVersion releases.  Per ADR 0051, each released
  // fixVersion is one deployment event — NOT collapsed to distinct days.
  // -------------------------------------------------------------------------
  describe('fixVersion path', () => {
    it('emits one event per released version in period', () => {
      const result = deriveDeploymentEvents({
        issues: [],
        versions: [
          makeVersion({ name: '1.0.0', releaseDate: new Date('2025-02-01') }),
          makeVersion({ name: '1.1.0', releaseDate: new Date('2025-02-15') }),
          makeVersion({ name: '1.2.0', releaseDate: new Date('2025-03-01') }),
        ],
        changelogs: [],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(3);
      expect(result.events.every((e) => e.source === 'fixVersion')).toBe(true);
      expect(result.events.map((e) => e.versionName).sort()).toEqual([
        '1.0.0',
        '1.1.0',
        '1.2.0',
      ]);
    });

    it('emits one event PER version when multiple ship on the same day (ADR 0051 supersedes day-bucketing)', () => {
      const sameDay = new Date('2025-02-15');
      const result = deriveDeploymentEvents({
        issues: [],
        versions: [
          makeVersion({ name: '1.0.0', releaseDate: sameDay }),
          makeVersion({ name: '1.0.1', releaseDate: sameDay }),
          makeVersion({ name: '1.0.2', releaseDate: sameDay }),
        ],
        changelogs: [],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(3);
    });

    it('excludes unreleased versions', () => {
      const result = deriveDeploymentEvents({
        issues: [],
        versions: [
          makeVersion({ name: '1.0.0', released: false }),
          makeVersion({ name: '1.1.0', released: true }),
        ],
        changelogs: [],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(1);
      expect(result.events[0].versionName).toBe('1.1.0');
    });

    it('excludes versions outside the period', () => {
      const result = deriveDeploymentEvents({
        issues: [],
        versions: [
          makeVersion({ name: '0.9.0', releaseDate: new Date('2024-12-15') }),
          makeVersion({ name: '1.0.0', releaseDate: new Date('2025-02-01') }),
          makeVersion({ name: '2.0.0', releaseDate: new Date('2025-06-01') }),
        ],
        changelogs: [],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(1);
      expect(result.events[0].versionName).toBe('1.0.0');
    });

    it('marks issues with matching fixVersion as deployed', () => {
      const result = deriveDeploymentEvents({
        issues: [
          makeIssue({ key: 'ACC-1', fixVersion: '1.0.0' }),
          makeIssue({ key: 'ACC-2', fixVersion: '1.0.0' }),
          makeIssue({ key: 'ACC-3', fixVersion: '1.0.0' }),
        ],
        versions: [makeVersion({ name: '1.0.0' })],
        changelogs: [],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      // 3 issues attached to 1 release = 1 event, 3 deployed keys
      expect(result.events.length).toBe(1);
      expect(result.deployedIssueKeys.size).toBe(3);
      expect([...result.deployedIssueKeys].sort()).toEqual([
        'ACC-1',
        'ACC-2',
        'ACC-3',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Fallback path: issues with no fixVersion that transitioned to done.
  // -------------------------------------------------------------------------
  describe('doneTransition path', () => {
    it('emits one event per first done-transition for issues without fixVersion', () => {
      const result = deriveDeploymentEvents({
        issues: [
          makeIssue({ key: 'ACC-1', fixVersion: null }),
          makeIssue({ key: 'ACC-2', fixVersion: null }),
        ],
        versions: [],
        changelogs: [
          makeChangelog({ issueKey: 'ACC-1', changedAt: new Date('2025-02-01') }),
          makeChangelog({ issueKey: 'ACC-2', changedAt: new Date('2025-02-01') }),
        ],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      // 2 events on same day — NOT collapsed
      expect(result.events.length).toBe(2);
      expect(result.events.every((e) => e.source === 'doneTransition')).toBe(true);
      expect([...result.deployedIssueKeys].sort()).toEqual(['ACC-1', 'ACC-2']);
    });

    it('counts only the first done-transition per issue (ignores re-opens)', () => {
      const result = deriveDeploymentEvents({
        issues: [makeIssue({ key: 'ACC-1', fixVersion: null })],
        versions: [],
        changelogs: [
          makeChangelog({ issueKey: 'ACC-1', changedAt: new Date('2025-02-01') }),
          makeChangelog({ issueKey: 'ACC-1', changedAt: new Date('2025-02-15') }),
        ],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(1);
    });

    it('skips issues whose fixVersion matched a release (no double-count)', () => {
      const result = deriveDeploymentEvents({
        issues: [makeIssue({ key: 'ACC-1', fixVersion: '1.0.0' })],
        versions: [makeVersion({ name: '1.0.0' })],
        changelogs: [
          makeChangelog({ issueKey: 'ACC-1', changedAt: new Date('2025-02-15') }),
        ],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      // 1 event from fixVersion only; doneTransition skipped because
      // ACC-1 is already in deployedIssueKeys via the fixVersion path
      expect(result.events.length).toBe(1);
      expect(result.events[0].source).toBe('fixVersion');
    });

    it('respects doneStatuses configuration', () => {
      const result = deriveDeploymentEvents({
        issues: [makeIssue({ key: 'ACC-1', fixVersion: null })],
        versions: [],
        changelogs: [
          makeChangelog({ issueKey: 'ACC-1', toValue: 'Resolved' }),
        ],
        doneStatuses: ['Done'], // 'Resolved' not included
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(0);
    });

    it('excludes non-status changelog entries', () => {
      const result = deriveDeploymentEvents({
        issues: [makeIssue({ key: 'ACC-1', fixVersion: null })],
        versions: [],
        changelogs: [
          makeChangelog({ issueKey: 'ACC-1', field: 'assignee', toValue: 'Done' }),
        ],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(0);
    });

    it('excludes transitions outside the period', () => {
      const result = deriveDeploymentEvents({
        issues: [makeIssue({ key: 'ACC-1', fixVersion: null })],
        versions: [],
        changelogs: [
          makeChangelog({ issueKey: 'ACC-1', changedAt: new Date('2025-06-01') }),
        ],
        doneStatuses: [...DONE],
        startDate: start,
        endDate: end,
      });

      expect(result.events.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Issue-type filtering: epics and subtasks are excluded (ADR 0018)
  // -------------------------------------------------------------------------
  it('excludes epics and subtasks from both paths (ADR 0018)', () => {
    const result = deriveDeploymentEvents({
      issues: [
        makeIssue({ key: 'ACC-1', issueType: 'Epic', fixVersion: '1.0.0' }),
        makeIssue({ key: 'ACC-2', issueType: 'Sub-task', fixVersion: null }),
        makeIssue({ key: 'ACC-3', issueType: 'Story', fixVersion: '1.0.0' }),
      ],
      versions: [makeVersion({ name: '1.0.0' })],
      changelogs: [
        makeChangelog({ issueKey: 'ACC-2', changedAt: new Date('2025-02-15') }),
      ],
      doneStatuses: [...DONE],
      startDate: start,
      endDate: end,
    });

    // 1 fixVersion event; ACC-3 deployed; epic + subtask filtered out
    expect(result.events.length).toBe(1);
    expect([...result.deployedIssueKeys]).toEqual(['ACC-3']);
  });

  // -------------------------------------------------------------------------
  // Acceptance criterion from feature 0002 / proposal 0049
  // -------------------------------------------------------------------------
  it('AC: 10 fixVersion releases produce 10 events (CFR denominator)', () => {
    const versions: JiraVersion[] = Array.from({ length: 10 }, (_, i) =>
      makeVersion({
        id: `v${i}`,
        name: `1.${i}.0`,
        releaseDate: new Date(Date.UTC(2025, 1, i + 1)),
      }),
    );

    const result = deriveDeploymentEvents({
      issues: [],
      versions,
      changelogs: [],
      doneStatuses: [...DONE],
      startDate: start,
      endDate: end,
    });

    const events: readonly DeploymentEvent[] = result.events;
    expect(events.length).toBe(10);
  });
});
