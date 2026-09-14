import { describe, it, expect } from '@jest/globals';
import { computeConfigHash, fingerprintBoard } from './healthcheck-config-hash.js';
import type { BoardConfig } from '../database/entities/index.js';

function config(overrides: Partial<BoardConfig> = {}): BoardConfig {
  return {
    boardId: 'ACC',
    boardType: 'scrum',
    doneStatusNames: ['Done', 'Closed', 'Released'],
    inProgressStatusNames: ['In Progress', 'Blocked'],
    cancelledStatusNames: ['Cancelled', "Won't Do"],
    boardEntryStatuses: null,
    ...overrides,
  } as unknown as BoardConfig;
}

describe('computeConfigHash', () => {
  it('is stable for the same configuration', () => {
    expect(computeConfigHash([config()])).toBe(computeConfigHash([config()]));
  });

  it('is insensitive to the order of inProgressStatusNames', () => {
    const a = computeConfigHash([config({ inProgressStatusNames: ['In Progress', 'Blocked'] })]);
    const b = computeConfigHash([config({ inProgressStatusNames: ['Blocked', 'In Progress'] })]);
    expect(a).toBe(b);
  });

  it('is insensitive to the order boards are supplied in', () => {
    const acc = config({ boardId: 'ACC' });
    const bpt = config({ boardId: 'BPT' });
    expect(computeConfigHash([acc, bpt])).toBe(computeConfigHash([bpt, acc]));
  });

  it('changes when a status is ADDED to inProgressStatusNames', () => {
    // Adding an entry can only move a first_start earlier or leave it, so a week
    // gains tickets from later weeks and loses them to earlier ones. That must
    // be detectable.
    const before = computeConfigHash([config({ inProgressStatusNames: ['In Progress'] })]);
    const after = computeConfigHash([
      config({ inProgressStatusNames: ['In Progress', 'READY'] }),
    ]);
    expect(after).not.toBe(before);
  });

  it('changes when only the CASING of a status changes', () => {
    // The denominator predicate is case-sensitive (`inProgressStatuses.has(toValue)`),
    // so a casing change is a real semantic change, not cosmetic.
    const lower = computeConfigHash([config({ inProgressStatusNames: ['ready for testing'] })]);
    const upper = computeConfigHash([config({ inProgressStatusNames: ['READY FOR TESTING'] })]);
    expect(lower).not.toBe(upper);
  });

  it('changes when a board is added or removed (board filter identity)', () => {
    const one = computeConfigHash([config({ boardId: 'ACC' })]);
    const two = computeConfigHash([config({ boardId: 'ACC' }), config({ boardId: 'BPT' })]);
    expect(one).not.toBe(two);
  });

  it('changes when a board flips between scrum and kanban', () => {
    // boardType decides whether a board contributes to Stability/Roadmap at all.
    const scrum = computeConfigHash([config({ boardType: 'scrum' })]);
    const kanban = computeConfigHash([config({ boardType: 'kanban' })]);
    expect(scrum).not.toBe(kanban);
  });

  it('changes when doneStatusNames or cancelledStatusNames change', () => {
    const base = computeConfigHash([config()]);
    expect(computeConfigHash([config({ doneStatusNames: ['Done'] })])).not.toBe(base);
    expect(computeConfigHash([config({ cancelledStatusNames: ['Cancelled'] })])).not.toBe(base);
  });

  it('changes when boardEntryStatuses change (kanban denominator predicate)', () => {
    const nullEntry = computeConfigHash([config({ boardEntryStatuses: null })]);
    const setEntry = computeConfigHash([config({ boardEntryStatuses: ['To Do'] })]);
    expect(nullEntry).not.toBe(setEntry);
  });
});

describe('fingerprintBoard', () => {
  it('sorts every status list and normalises boardType', () => {
    const fp = fingerprintBoard(
      config({
        boardType: 'something-else',
        inProgressStatusNames: ['In Progress', 'Blocked', 'READY'],
      }),
    );
    expect(fp.boardType).toBe('scrum');
    expect(fp.inProgressStatusNames).toEqual(['Blocked', 'In Progress', 'READY']);
  });

  it('treats a null list as empty rather than throwing', () => {
    const fp = fingerprintBoard(config({ boardEntryStatuses: null }));
    expect(fp.boardEntryStatuses).toEqual([]);
  });
});
