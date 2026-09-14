/**
 * healthcheck-drift.ts
 *
 * Pure comparison of a stored weekly Healthcheck figure against a live
 * recompute (ADR 0092).
 *
 * Drift on a **closed** week is a signal, not an error to be swallowed. The
 * denominator is defined as
 *
 *   first_start(t) = min over t.changelog of transitions into an in-progress status
 *   denominator(W) = { t : board(t) is a scrum board, first_start(t) in window(W) }
 *
 * `first_start` is a minimum over an append-only history, so once the changelog
 * contains the event no later event can be earlier than it. A closed week's
 * denominator is therefore immutable unless board membership or the predicate
 * config changed. If it moved anyway, something is wrong — and specifically, a
 * ticket's `first_start` moving **later** cannot happen legitimately at all: it
 * is the signature of a truncated or partially-rebuilt stored changelog.
 *
 * Nothing here mutates or auto-corrects the stored figure. Overwriting it would
 * destroy the evidence that a discrepancy existed.
 */

export interface DimensionDrift {
  stored: { numerator: number | null; denominator: number };
  live: { numerator: number | null; denominator: number };
  changed: boolean;
}

/** A ticket whose derived `first_start` moved later — an invariant violation. */
export interface FirstStartRegression {
  key: string;
  stored: string;
  live: string;
}

export interface HealthcheckDrift {
  storedComputedAt: string;
  configHashChanged: boolean;
  storedConfigHash: string;
  liveConfigHash: string;
  stability: DimensionDrift;
  roadmap: DimensionDrift;
  support: DimensionDrift;
  /** Ticket keys present in the stored figure but absent from the live one. */
  ticketsRemoved: string[];
  /** Ticket keys present in the live figure but absent from the stored one. */
  ticketsAdded: string[];
  /**
   * Tickets whose derived `first_start` moved LATER than the stored value.
   * `first_start` is a minimum over an append-only history, so this is always a
   * defect — never a legitimate data update.
   */
  firstStartRegressions: FirstStartRegression[];
  /** True when any of the above indicates a difference. */
  hasDrift: boolean;
}

interface DimensionLike {
  numerator: number | null;
  denominator: number;
}

function compareDimension(stored: DimensionLike, live: DimensionLike): DimensionDrift {
  return {
    stored: { numerator: stored.numerator, denominator: stored.denominator },
    live: { numerator: live.numerator, denominator: live.denominator },
    changed:
      stored.numerator !== live.numerator || stored.denominator !== live.denominator,
  };
}

export interface DriftInput {
  storedComputedAt: Date;
  storedConfigHash: string;
  liveConfigHash: string;
  stored: {
    stability: DimensionLike;
    roadmap: DimensionLike;
    support: DimensionLike;
    ticketKeys: string[];
    firstStarts: Record<string, string>;
  };
  live: {
    stability: DimensionLike;
    roadmap: DimensionLike;
    support: DimensionLike;
    ticketKeys: string[];
    firstStarts: Record<string, string>;
  };
}

export function compareHealthcheck(input: DriftInput): HealthcheckDrift {
  const stability = compareDimension(input.stored.stability, input.live.stability);
  const roadmap = compareDimension(input.stored.roadmap, input.live.roadmap);
  const support = compareDimension(input.stored.support, input.live.support);

  const storedKeys = new Set(input.stored.ticketKeys);
  const liveKeys = new Set(input.live.ticketKeys);
  const ticketsRemoved = input.stored.ticketKeys.filter((k) => !liveKeys.has(k)).sort();
  const ticketsAdded = input.live.ticketKeys.filter((k) => !storedKeys.has(k)).sort();

  const firstStartRegressions: FirstStartRegression[] = [];
  for (const [key, storedAt] of Object.entries(input.stored.firstStarts)) {
    const liveAt = input.live.firstStarts[key];
    // A ticket dropping out entirely is reported via ticketsRemoved, not here —
    // this check is specifically about a surviving ticket's minimum moving late.
    if (liveAt === undefined) continue;
    if (new Date(liveAt) > new Date(storedAt)) {
      firstStartRegressions.push({ key, stored: storedAt, live: liveAt });
    }
  }
  firstStartRegressions.sort((a, b) => a.key.localeCompare(b.key));

  const configHashChanged = input.storedConfigHash !== input.liveConfigHash;

  return {
    storedComputedAt: input.storedComputedAt.toISOString(),
    configHashChanged,
    storedConfigHash: input.storedConfigHash,
    liveConfigHash: input.liveConfigHash,
    stability,
    roadmap,
    support,
    ticketsRemoved,
    ticketsAdded,
    firstStartRegressions,
    hasDrift:
      stability.changed ||
      roadmap.changed ||
      support.changed ||
      ticketsRemoved.length > 0 ||
      ticketsAdded.length > 0 ||
      firstStartRegressions.length > 0 ||
      configHashChanged,
  };
}
