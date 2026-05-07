import { resolveEpicIdeas, type ResolveIdeaInput } from './resolve-epic-ideas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(
  key: string,
  deliveryIssueKeys: string[] | null,
  targetDate: Date | null,
  startDate: Date | null = new Date('2026-01-01T00:00:00Z'),
  summary: string | null = key,
): ResolveIdeaInput {
  return { key, summary, deliveryIssueKeys, startDate, targetDate };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveEpicIdeas', () => {
  it('returns an empty map for empty input', () => {
    const result = resolveEpicIdeas([], 'earliest');
    expect(result.size).toBe(0);
  });

  it('returns primaryIdea with no conflicts when a single idea links the epic', () => {
    const idea = makeInput('JPD-1', ['EPIC-1'], new Date('2026-06-01T00:00:00Z'));
    const result = resolveEpicIdeas([idea], 'earliest');
    expect(result.size).toBe(1);
    const entry = result.get('EPIC-1')!;
    expect(entry.primaryIdea.ideaKey).toBe('JPD-1');
    expect(entry.primaryIdea.ideaSummary).toBe('JPD-1');
    expect(entry.primaryIdea.targetDate).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(entry.conflictingIdeas).toEqual([]);
  });

  it('skips ideas missing startDate or targetDate', () => {
    const noStart = makeInput('JPD-1', ['EPIC-1'], new Date('2026-06-01T00:00:00Z'), null);
    const noTarget = makeInput('JPD-2', ['EPIC-1'], null, new Date('2026-01-01T00:00:00Z'));
    const result = resolveEpicIdeas([noStart, noTarget], 'earliest');
    expect(result.size).toBe(0);
  });

  it('skips ideas with null deliveryIssueKeys', () => {
    const idea = makeInput('JPD-1', null, new Date('2026-06-01T00:00:00Z'));
    const result = resolveEpicIdeas([idea], 'earliest');
    expect(result.size).toBe(0);
  });

  it('default rule "earliest": picks earliest targetDate as primary; rest are conflicts with signed daysFromPrimary', () => {
    const a = makeInput('JPD-A', ['EPIC-1'], new Date('2026-07-15T00:00:00Z'), undefined as unknown as Date, 'A summary');
    const b = makeInput('JPD-B', ['EPIC-1'], new Date('2026-06-01T00:00:00Z'), undefined as unknown as Date, 'B summary');
    const c = makeInput('JPD-C', ['EPIC-1'], new Date('2026-09-01T00:00:00Z'), undefined as unknown as Date, 'C summary');

    const result = resolveEpicIdeas([a, b, c], 'earliest');
    const entry = result.get('EPIC-1')!;

    // Earliest is JPD-B (2026-06-01)
    expect(entry.primaryIdea.ideaKey).toBe('JPD-B');
    expect(entry.primaryIdea.targetDate).toEqual(new Date('2026-06-01T00:00:00Z'));

    // Conflicts ordered by sort: JPD-A (Jul 15), JPD-C (Sep 1)
    expect(entry.conflictingIdeas).toHaveLength(2);

    const aConflict = entry.conflictingIdeas.find((c) => c.ideaKey === 'JPD-A')!;
    const cConflict = entry.conflictingIdeas.find((c) => c.ideaKey === 'JPD-C')!;

    expect(aConflict.ideaSummary).toBe('A summary');
    expect(aConflict.targetDate).toEqual(new Date('2026-07-15T00:00:00Z'));
    // 2026-07-15 - 2026-06-01 = 44 days (positive — later than primary)
    expect(aConflict.daysFromPrimary).toBe(44);

    expect(cConflict.ideaSummary).toBe('C summary');
    expect(cConflict.targetDate).toEqual(new Date('2026-09-01T00:00:00Z'));
    // 2026-09-01 - 2026-06-01 = 92 days
    expect(cConflict.daysFromPrimary).toBe(92);
  });

  it('rule "latest": picks latest targetDate as primary; conflicts have negative daysFromPrimary', () => {
    const a = makeInput('JPD-A', ['EPIC-1'], new Date('2026-07-15T00:00:00Z'));
    const b = makeInput('JPD-B', ['EPIC-1'], new Date('2026-06-01T00:00:00Z'));
    const c = makeInput('JPD-C', ['EPIC-1'], new Date('2026-09-01T00:00:00Z'));

    const result = resolveEpicIdeas([a, b, c], 'latest');
    const entry = result.get('EPIC-1')!;

    // Latest is JPD-C (2026-09-01)
    expect(entry.primaryIdea.ideaKey).toBe('JPD-C');
    expect(entry.primaryIdea.targetDate).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(entry.conflictingIdeas).toHaveLength(2);

    const aConflict = entry.conflictingIdeas.find((c) => c.ideaKey === 'JPD-A')!;
    const bConflict = entry.conflictingIdeas.find((c) => c.ideaKey === 'JPD-B')!;
    // 2026-07-15 - 2026-09-01 = -48 days
    expect(aConflict.daysFromPrimary).toBe(-48);
    // 2026-06-01 - 2026-09-01 = -92 days
    expect(bConflict.daysFromPrimary).toBe(-92);
  });

  it('handles a mix of conflicting and non-conflicting epics in one call', () => {
    const i1 = makeInput('JPD-1', ['EPIC-A'], new Date('2026-06-01T00:00:00Z'));
    const i2 = makeInput('JPD-2', ['EPIC-A'], new Date('2026-07-01T00:00:00Z'));
    const i3 = makeInput('JPD-3', ['EPIC-B'], new Date('2026-08-01T00:00:00Z'));

    const result = resolveEpicIdeas([i1, i2, i3], 'earliest');
    expect(result.size).toBe(2);

    const epicA = result.get('EPIC-A')!;
    expect(epicA.primaryIdea.ideaKey).toBe('JPD-1');
    expect(epicA.conflictingIdeas).toHaveLength(1);
    expect(epicA.conflictingIdeas[0].ideaKey).toBe('JPD-2');

    const epicB = result.get('EPIC-B')!;
    expect(epicB.primaryIdea.ideaKey).toBe('JPD-3');
    expect(epicB.conflictingIdeas).toEqual([]);
  });

  it('AC5 verbatim — three ideas (2026-06-01, 2026-07-15, 2026-09-01) under default rule', () => {
    const ideas = [
      makeInput('JPD-1', ['EPIC-1'], new Date('2026-06-01T00:00:00Z')),
      makeInput('JPD-2', ['EPIC-1'], new Date('2026-07-15T00:00:00Z')),
      makeInput('JPD-3', ['EPIC-1'], new Date('2026-09-01T00:00:00Z')),
    ];
    const result = resolveEpicIdeas(ideas, 'earliest');
    const entry = result.get('EPIC-1')!;
    expect(entry.primaryIdea.targetDate).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(entry.conflictingIdeas).toHaveLength(2);
  });

  it('AC5 verbatim — same three ideas under "latest" override', () => {
    const ideas = [
      makeInput('JPD-1', ['EPIC-1'], new Date('2026-06-01T00:00:00Z')),
      makeInput('JPD-2', ['EPIC-1'], new Date('2026-07-15T00:00:00Z')),
      makeInput('JPD-3', ['EPIC-1'], new Date('2026-09-01T00:00:00Z')),
    ];
    const result = resolveEpicIdeas(ideas, 'latest');
    const entry = result.get('EPIC-1')!;
    expect(entry.primaryIdea.targetDate).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(entry.conflictingIdeas).toHaveLength(2);
  });

  it('one idea linking multiple epics: each epic resolves independently', () => {
    const idea = makeInput('JPD-1', ['EPIC-A', 'EPIC-B'], new Date('2026-06-01T00:00:00Z'));
    const result = resolveEpicIdeas([idea], 'earliest');
    expect(result.size).toBe(2);
    expect(result.get('EPIC-A')!.primaryIdea.ideaKey).toBe('JPD-1');
    expect(result.get('EPIC-B')!.primaryIdea.ideaKey).toBe('JPD-1');
  });
});
