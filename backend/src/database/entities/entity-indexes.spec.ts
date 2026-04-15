/**
 * entity-indexes.spec.ts
 *
 * Verifies that performance-critical columns have @Index() decorators on the
 * entities that are queried most heavily by the DORA metrics pipeline.
 *
 * We interrogate TypeORM's in-memory metadata storage directly — no database
 * connection required.  If someone accidentally removes an @Index decorator
 * this suite catches it immediately.
 */
import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';

// Static imports so entity metadata is registered before any test runs.
import { JiraIssue } from './jira-issue.entity.js';
import { JiraChangelog } from './jira-changelog.entity.js';
import { JiraVersion } from './jira-version.entity.js';
import { JiraSprint } from './jira-sprint.entity.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Returns all index entries registered for a given entity class. */
function indexEntriesFor(
  entityClass: Function,
): Array<{ columns: string[] }> {
  return getMetadataArgsStorage()
    .indices.filter((idx) => idx.target === entityClass)
    .map((idx) => ({ columns: (idx.columns as string[]) ?? [] }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Entity index declarations', () => {
  describe('JiraIssue (jira_issues)', () => {
    it('has an index on boardId', () => {
      const entries = indexEntriesFor(JiraIssue);
      expect(entries.some((e) => e.columns.includes('boardId'))).toBe(true);
    });

    it('has an index on issueType', () => {
      const entries = indexEntriesFor(JiraIssue);
      expect(entries.some((e) => e.columns.includes('issueType'))).toBe(true);
    });

    it('has an index on status', () => {
      const entries = indexEntriesFor(JiraIssue);
      expect(entries.some((e) => e.columns.includes('status'))).toBe(true);
    });
  });

  describe('JiraChangelog (jira_changelogs)', () => {
    it('has an index on issueKey', () => {
      const entries = indexEntriesFor(JiraChangelog);
      expect(entries.some((e) => e.columns.includes('issueKey'))).toBe(true);
    });

    it('has an index on field', () => {
      const entries = indexEntriesFor(JiraChangelog);
      expect(entries.some((e) => e.columns.includes('field'))).toBe(true);
    });

    it('has a compound index on (issueKey, field)', () => {
      const entries = indexEntriesFor(JiraChangelog);
      const hasCompound = entries.some(
        (e) =>
          e.columns.includes('issueKey') && e.columns.includes('field'),
      );
      expect(hasCompound).toBe(true);
    });
  });

  describe('JiraVersion (jira_versions)', () => {
    it('has an index on projectKey', () => {
      const entries = indexEntriesFor(JiraVersion);
      expect(entries.some((e) => e.columns.includes('projectKey'))).toBe(true);
    });

    it('has a compound index on (projectKey, releaseDate)', () => {
      const entries = indexEntriesFor(JiraVersion);
      const hasCompound = entries.some(
        (e) =>
          e.columns.includes('projectKey') &&
          e.columns.includes('releaseDate'),
      );
      expect(hasCompound).toBe(true);
    });
  });

  describe('JiraSprint (jira_sprints)', () => {
    it('has an index on boardId', () => {
      const entries = indexEntriesFor(JiraSprint);
      expect(entries.some((e) => e.columns.includes('boardId'))).toBe(true);
    });

    it('has a compound index on (boardId, state)', () => {
      const entries = indexEntriesFor(JiraSprint);
      const hasCompound = entries.some(
        (e) =>
          e.columns.includes('boardId') && e.columns.includes('state'),
      );
      expect(hasCompound).toBe(true);
    });
  });
});
