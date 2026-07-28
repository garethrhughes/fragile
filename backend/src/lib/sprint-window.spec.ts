/**
 * Unit tests for effectiveSprintEnd (feature 0015, proposal 0072).
 */
import { effectiveSprintEnd } from './sprint-window.js';

describe('effectiveSprintEnd', () => {
  const endDate = new Date('2026-07-02T16:00:00.000Z');
  const completeDate = new Date('2026-07-06T00:12:39.131Z');
  const now = new Date('2026-07-28T00:00:00.000Z');

  it('uses completeDate when the sprint has been closed late', () => {
    expect(effectiveSprintEnd({ completeDate, endDate }, now)).toBe(completeDate);
  });

  it('falls back to endDate when completeDate is null', () => {
    expect(effectiveSprintEnd({ completeDate: null, endDate }, now)).toBe(endDate);
  });

  it('falls back to endDate when completeDate is undefined', () => {
    expect(effectiveSprintEnd({ endDate }, now)).toBe(endDate);
  });

  it('falls back to now when neither completeDate nor endDate is set (active sprint)', () => {
    expect(effectiveSprintEnd({ completeDate: null, endDate: null }, now)).toBe(now);
  });

  it('prefers completeDate even when it is earlier than endDate (closed early)', () => {
    const earlyComplete = new Date('2026-07-01T09:00:00.000Z');
    expect(effectiveSprintEnd({ completeDate: earlyComplete, endDate }, now)).toBe(
      earlyComplete,
    );
  });
});
