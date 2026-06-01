import { classifyRoadmapStatus, type RoadmapClassificationInput } from './roadmap-classification.js';

describe('classifyRoadmapStatus', () => {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function makeInput(overrides: Partial<RoadmapClassificationInput> = {}): RoadmapClassificationInput {
    return {
      issueStatus: 'In Progress',
      isCancelled: false,
      epicIdea: undefined,
      directIdea: undefined,
      resolvedDate: null,
      isPeriodActive: true,
      doneStatusNames: ['Done', 'Closed'],
      ...overrides,
    };
  }

  const jan15 = new Date(Date.UTC(2025, 0, 15));
  const jan31 = new Date(Date.UTC(2025, 0, 31));
  const feb15 = new Date(Date.UTC(2025, 1, 15));

  // ---------------------------------------------------------------------------
  // No link → 'none'
  // ---------------------------------------------------------------------------

  describe('when issue has no roadmap link', () => {
    it('returns none with null linkSource when no epic or direct idea', () => {
      const result = classifyRoadmapStatus(makeInput());
      expect(result).toEqual({ status: 'none', linkSource: null });
    });
  });

  // ---------------------------------------------------------------------------
  // Cancelled issue → 'none'
  // ---------------------------------------------------------------------------

  describe('when issue is cancelled', () => {
    it('returns none regardless of linked ideas', () => {
      const result = classifyRoadmapStatus(makeInput({
        isCancelled: true,
        epicIdea: { targetDate: jan31 },
      }));
      expect(result).toEqual({ status: 'none', linkSource: null });
    });
  });

  // ---------------------------------------------------------------------------
  // Null targetDate → 'linked'
  // ---------------------------------------------------------------------------

  describe('when idea has null targetDate', () => {
    it('returns linked via epic', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: null },
      }));
      expect(result).toEqual({ status: 'linked', linkSource: 'epic' });
    });

    it('returns linked via direct link', () => {
      const result = classifyRoadmapStatus(makeInput({
        directIdea: { targetDate: null },
      }));
      expect(result).toEqual({ status: 'linked', linkSource: 'direct' });
    });
  });

  // ---------------------------------------------------------------------------
  // Epic link takes priority over direct link (ADR 0044)
  // ---------------------------------------------------------------------------

  describe('link priority', () => {
    it('uses epic idea when both epic and direct ideas exist', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: jan31 },
        directIdea: { targetDate: feb15 },
        resolvedDate: jan15, // delivered before epic targetDate
      }));
      expect(result).toEqual({ status: 'in-scope', linkSource: 'epic' });
    });

    it('falls back to direct idea when no epic idea', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: undefined,
        directIdea: { targetDate: jan31 },
        resolvedDate: jan15, // delivered before targetDate
      }));
      expect(result).toEqual({ status: 'in-scope', linkSource: 'direct' });
    });
  });

  // ---------------------------------------------------------------------------
  // Condition A: delivered on time
  // ---------------------------------------------------------------------------

  describe('Condition A — delivered on time', () => {
    it('returns in-scope when resolved before targetDate', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: jan31 },
        resolvedDate: jan15,
      }));
      expect(result).toEqual({ status: 'in-scope', linkSource: 'epic' });
    });

    it('returns in-scope when resolved exactly on targetDate (end of day)', () => {
      // Resolved at start of target day — should be in-scope
      const resolvedOnTargetDay = new Date(Date.UTC(2025, 0, 31, 10, 0, 0));
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: jan31 },
        resolvedDate: resolvedOnTargetDay,
      }));
      expect(result).toEqual({ status: 'in-scope', linkSource: 'epic' });
    });

    it('returns linked when resolved after targetDate (end of day)', () => {
      const resolvedAfterTarget = new Date(Date.UTC(2025, 1, 1, 0, 0, 0));
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: jan31 },
        resolvedDate: resolvedAfterTarget,
      }));
      expect(result).toEqual({ status: 'linked', linkSource: 'epic' });
    });
  });

  // ---------------------------------------------------------------------------
  // Condition B: in-flight on active period with target not yet passed
  // ---------------------------------------------------------------------------

  describe('Condition B — in-flight on active period', () => {
    it('returns in-scope when period is active, target not passed, and issue not resolved', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: feb15 },
        resolvedDate: null,
        isPeriodActive: true,
        todayStart: jan15,
        issueStatus: 'In Progress',
      }));
      expect(result).toEqual({ status: 'in-scope', linkSource: 'epic' });
    });

    it('returns linked when period is NOT active', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: feb15 },
        resolvedDate: null,
        isPeriodActive: false,
        todayStart: jan15,
        issueStatus: 'In Progress',
      }));
      expect(result).toEqual({ status: 'linked', linkSource: 'epic' });
    });

    it('returns linked when target date has passed', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: jan15 },
        resolvedDate: null,
        isPeriodActive: true,
        todayStart: jan31,
        issueStatus: 'In Progress',
      }));
      expect(result).toEqual({ status: 'linked', linkSource: 'epic' });
    });

    it('returns linked when issue is already done (resolvedDate set)', () => {
      // Issue resolved but AFTER targetDate — neither Condition A nor B applies
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: jan15 },
        resolvedDate: jan31, // resolved after target
        isPeriodActive: true,
        todayStart: jan15,
        issueStatus: 'Done',
      }));
      expect(result).toEqual({ status: 'linked', linkSource: 'epic' });
    });

    it('returns linked when issue status is in done list', () => {
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: feb15 },
        resolvedDate: null,
        isPeriodActive: true,
        todayStart: jan15,
        issueStatus: 'Done',
        doneStatusNames: ['Done', 'Closed'],
      }));
      expect(result).toEqual({ status: 'linked', linkSource: 'epic' });
    });
  });

  // ---------------------------------------------------------------------------
  // todayStart defaults to current date when not provided
  // ---------------------------------------------------------------------------

  describe('todayStart default', () => {
    it('uses current UTC midnight when todayStart is not provided', () => {
      // We cannot deterministically test the "now" default without mocking Date,
      // but we CAN verify the function does not throw when todayStart is omitted.
      const result = classifyRoadmapStatus(makeInput({
        epicIdea: { targetDate: new Date(Date.UTC(2099, 0, 1)) },
        resolvedDate: null,
        isPeriodActive: true,
        issueStatus: 'In Progress',
      }));
      // With a far-future target date and active period, should be in-scope
      expect(result).toEqual({ status: 'in-scope', linkSource: 'epic' });
    });
  });
});
