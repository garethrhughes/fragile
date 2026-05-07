import { extractCycles, resolveResetNames } from './cycle.js';
import type { JiraChangelog } from '../database/entities/jira-changelog.entity.js';

function cl(
  issueKey: string,
  toValue: string | null,
  changedAt: Date,
  field = 'status',
): JiraChangelog {
  return {
    id: 0,
    issueKey,
    field,
    fromValue: null,
    toValue,
    fromId: null,
    toId: null,
    changedAt,
  } as JiraChangelog;
}

const IP = new Set(['In Progress']);
const DONE = new Set(['Done']);
const RESET = new Set(['To Do', 'Backlog']);

describe('extractCycles', () => {
  it('returns null on empty changelog', () => {
    expect(extractCycles([], IP, DONE, RESET)).toBeNull();
  });

  it('returns single cycle for IP -> Done', () => {
    const t1 = new Date('2026-01-02T00:00:00Z');
    const t2 = new Date('2026-01-05T00:00:00Z');
    const result = extractCycles(
      [
        cl('ACC-1', 'In Progress', t1),
        cl('ACC-1', 'Done', t2),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(1);
    expect(result!.representative).toBe(result!.cycles[0]);
    expect(result!.cycles[0].isReopen).toBe(false);
    expect(result!.cycles[0].start).toEqual(t1);
    expect(result!.cycles[0].end).toEqual(t2);
    expect(result!.anomalyCount).toBe(0);
  });

  it('returns 2 cycles for IP -> Done -> Backlog -> IP -> Done with second as representative', () => {
    const t1 = new Date('2026-01-02T00:00:00Z');
    const t2 = new Date('2026-01-05T00:00:00Z');
    const t3 = new Date('2026-01-06T00:00:00Z');
    const t4 = new Date('2026-01-08T00:00:00Z');
    const t5 = new Date('2026-01-10T00:00:00Z');
    const result = extractCycles(
      [
        cl('ACC-1', 'In Progress', t1),
        cl('ACC-1', 'Done', t2),
        cl('ACC-1', 'Backlog', t3),
        cl('ACC-1', 'In Progress', t4),
        cl('ACC-1', 'Done', t5),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(2);
    expect(result!.representative).toBe(result!.cycles[1]);
    expect(result!.cycles[0].isReopen).toBe(false);
    expect(result!.cycles[1].isReopen).toBe(true);
    expect(result!.cycles[1].start).toEqual(t4);
    expect(result!.cycles[1].end).toEqual(t5);
    expect(result!.anomalyCount).toBe(0);
  });

  it('ignores leading Done before any IP (Done -> IP -> Done)', () => {
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-01-03T00:00:00Z');
    const t3 = new Date('2026-01-06T00:00:00Z');
    const result = extractCycles(
      [
        cl('ACC-1', 'Done', t1),
        cl('ACC-1', 'In Progress', t2),
        cl('ACC-1', 'Done', t3),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(1);
    expect(result!.cycles[0].start).toEqual(t2);
    expect(result!.cycles[0].end).toEqual(t3);
    expect(result!.cycles[0].isReopen).toBe(false);
    expect(result!.anomalyCount).toBe(0);
  });

  it('handles 3 cycles, representative = third, only first not reopen', () => {
    const ts = (d: number) => new Date(`2026-01-${String(d).padStart(2, '0')}T00:00:00Z`);
    const result = extractCycles(
      [
        cl('A', 'In Progress', ts(1)),
        cl('A', 'Done', ts(2)),
        cl('A', 'To Do', ts(3)),
        cl('A', 'In Progress', ts(4)),
        cl('A', 'Done', ts(5)),
        cl('A', 'Backlog', ts(6)),
        cl('A', 'In Progress', ts(7)),
        cl('A', 'Done', ts(8)),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(3);
    expect(result!.representative).toBe(result!.cycles[2]);
    expect(result!.cycles[0].isReopen).toBe(false);
    expect(result!.cycles[1].isReopen).toBe(true);
    expect(result!.cycles[2].isReopen).toBe(true);
  });

  it('counts unmatched IP at end as anomaly: IP -> Done -> Backlog -> IP (no terminal Done)', () => {
    const ts = (d: number) => new Date(`2026-01-${String(d).padStart(2, '0')}T00:00:00Z`);
    const result = extractCycles(
      [
        cl('A', 'In Progress', ts(1)),
        cl('A', 'Done', ts(2)),
        cl('A', 'Backlog', ts(3)),
        cl('A', 'In Progress', ts(4)),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(1);
    expect(result!.representative).toBe(result!.cycles[0]);
    expect(result!.anomalyCount).toBe(1);
  });

  it('matches reset status case-insensitively', () => {
    const ts = (d: number) => new Date(`2026-01-${String(d).padStart(2, '0')}T00:00:00Z`);
    const result = extractCycles(
      [
        cl('A', 'In Progress', ts(1)),
        cl('A', 'Done', ts(2)),
        cl('A', 'BACKLOG', ts(3)),
        cl('A', 'In Progress', ts(4)),
        cl('A', 'Done', ts(5)),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(2);
    expect(result!.cycles[1].isReopen).toBe(true);
  });

  it('ignores changelog rows where field is not status', () => {
    const t1 = new Date('2026-01-02T00:00:00Z');
    const t2 = new Date('2026-01-03T00:00:00Z');
    const t3 = new Date('2026-01-05T00:00:00Z');
    const result = extractCycles(
      [
        cl('A', 'In Progress', t1),
        cl('A', 'Something', t2, 'priority'),
        cl('A', 'Done', t3),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(1);
    expect(result!.cycles[0].start).toEqual(t1);
    expect(result!.cycles[0].end).toEqual(t3);
  });

  it('returns null when no completed cycle exists (only IP, no Done)', () => {
    const t1 = new Date('2026-01-02T00:00:00Z');
    const result = extractCycles([cl('A', 'In Progress', t1)], IP, DONE, RESET);
    expect(result).toBeNull();
  });

  it('sorts unsorted changelogs ascending by changedAt', () => {
    const t1 = new Date('2026-01-02T00:00:00Z');
    const t2 = new Date('2026-01-05T00:00:00Z');
    const result = extractCycles(
      [
        cl('A', 'Done', t2),
        cl('A', 'In Progress', t1),
      ],
      IP,
      DONE,
      RESET,
    );
    expect(result).not.toBeNull();
    expect(result!.cycles).toHaveLength(1);
    expect(result!.cycles[0].start).toEqual(t1);
    expect(result!.cycles[0].end).toEqual(t2);
  });
});

describe('resolveResetNames', () => {
  it('returns boardEntryStatuses when non-empty', () => {
    expect(resolveResetNames(['Foo', 'Bar'])).toEqual(['Foo', 'Bar']);
  });

  it('returns default fallback when null', () => {
    expect(resolveResetNames(null)).toEqual(['To Do', 'Backlog', 'Open', 'Reopened']);
  });

  it('returns default fallback when empty array', () => {
    expect(resolveResetNames([])).toEqual(['To Do', 'Backlog', 'Open', 'Reopened']);
  });
});
