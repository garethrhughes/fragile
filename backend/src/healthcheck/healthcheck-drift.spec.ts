import { describe, it, expect } from '@jest/globals';
import { compareHealthcheck, type DriftInput } from './healthcheck-drift.js';

function side(
  overrides: Partial<DriftInput['stored']> = {},
): DriftInput['stored'] {
  return {
    stability: { numerator: 7, denominator: 23 },
    roadmap: { numerator: 12, denominator: 23 },
    support: { numerator: 8, denominator: 38 },
    ticketKeys: ['ACC-296', 'DATA-492'],
    firstStarts: {
      'ACC-296': '2026-08-27T02:28:36.515Z',
      'DATA-492': '2026-08-27T06:01:04.508Z',
    },
    ...overrides,
  };
}

function input(overrides: Partial<DriftInput> = {}): DriftInput {
  return {
    storedComputedAt: new Date('2026-09-07T00:00:00Z'),
    storedConfigHash: 'hash-a',
    liveConfigHash: 'hash-a',
    stored: side(),
    live: side(),
    ...overrides,
  };
}

describe('compareHealthcheck', () => {
  it('reports no drift when stored and live agree', () => {
    const drift = compareHealthcheck(input());
    expect(drift.hasDrift).toBe(false);
    expect(drift.stability.changed).toBe(false);
    expect(drift.ticketsAdded).toEqual([]);
    expect(drift.ticketsRemoved).toEqual([]);
    expect(drift.firstStartRegressions).toEqual([]);
  });

  it('detects a changed Stability denominator — the W35 signature', () => {
    // 7/23 = 30.43% stored vs 4/15 = 26.67% live: the denominator moved, not
    // only the numerator.
    const drift = compareHealthcheck(
      input({ live: side({ stability: { numerator: 4, denominator: 15 } }) }),
    );
    expect(drift.hasDrift).toBe(true);
    expect(drift.stability.changed).toBe(true);
    expect(drift.stability.stored).toEqual({ numerator: 7, denominator: 23 });
    expect(drift.stability.live).toEqual({ numerator: 4, denominator: 15 });
  });

  it('reports tickets that left and joined the week', () => {
    const drift = compareHealthcheck(
      input({
        live: side({
          ticketKeys: ['DATA-492', 'SPS-744'],
          firstStarts: {
            'DATA-492': '2026-08-27T06:01:04.508Z',
            'SPS-744': '2026-08-25T23:52:31.944Z',
          },
        }),
      }),
    );
    expect(drift.ticketsRemoved).toEqual(['ACC-296']);
    expect(drift.ticketsAdded).toEqual(['SPS-744']);
    expect(drift.hasDrift).toBe(true);
  });

  it('flags a first_start that moved LATER as a regression', () => {
    // first_start is a minimum over an append-only history, so it can never
    // legitimately increase. This is the signature of a truncated stored
    // changelog: ACC-296's apparent first start slides from its real 27 Aug
    // value to the 10 Sep re-entry.
    const drift = compareHealthcheck(
      input({
        live: side({
          firstStarts: {
            'ACC-296': '2026-09-10T01:55:14.574Z',
            'DATA-492': '2026-08-27T06:01:04.508Z',
          },
        }),
      }),
    );
    expect(drift.firstStartRegressions).toEqual([
      {
        key: 'ACC-296',
        stored: '2026-08-27T02:28:36.515Z',
        live: '2026-09-10T01:55:14.574Z',
      },
    ]);
    expect(drift.hasDrift).toBe(true);
  });

  it('does not flag a first_start that moved EARLIER as a regression', () => {
    // Legitimate: adding a status to inProgressStatusNames, or backfilling a
    // previously missing older changelog page, can only move a minimum earlier.
    const drift = compareHealthcheck(
      input({
        live: side({
          firstStarts: {
            'ACC-296': '2026-08-25T09:00:00.000Z',
            'DATA-492': '2026-08-27T06:01:04.508Z',
          },
        }),
      }),
    );
    expect(drift.firstStartRegressions).toEqual([]);
    expect(drift.hasDrift).toBe(false);
  });

  it('does not double-report a dropped ticket as a first_start regression', () => {
    const drift = compareHealthcheck(
      input({
        live: side({ ticketKeys: ['DATA-492'], firstStarts: { 'DATA-492': '2026-08-27T06:01:04.508Z' } }),
      }),
    );
    expect(drift.firstStartRegressions).toEqual([]);
    expect(drift.ticketsRemoved).toEqual(['ACC-296']);
  });

  it('flags a config hash change even when every count matches', () => {
    // The predicate moved but the counts happened to coincide — still drift,
    // because the two figures are no longer comparable.
    const drift = compareHealthcheck(input({ liveConfigHash: 'hash-b' }));
    expect(drift.configHashChanged).toBe(true);
    expect(drift.hasDrift).toBe(true);
    expect(drift.stability.changed).toBe(false);
  });

  it('carries the stored computedAt so the two runs can be dated', () => {
    const drift = compareHealthcheck(input());
    expect(drift.storedComputedAt).toBe('2026-09-07T00:00:00.000Z');
  });
});
