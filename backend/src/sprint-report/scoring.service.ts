import { Injectable } from '@nestjs/common';
import { DoraBand } from '../metrics/dora-bands.js';
import { classifyComposite, SprintReportBand } from './sprint-report-bands.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Canonical, ordered list of all scoreable dimensions. */
export type ScoreDimension =
  | 'deliveryRate'
  | 'scopeStability'
  | 'roadmapCoverage'
  | 'leadTime'
  | 'deploymentFrequency'
  | 'changeFailureRate'
  | 'mttr';

export const SCORE_DIMENSIONS: readonly ScoreDimension[] = [
  'deliveryRate',
  'scopeStability',
  'roadmapCoverage',
  'leadTime',
  'deploymentFrequency',
  'changeFailureRate',
  'mttr',
] as const;

/** Composite weights — must sum to 1.0. */
const WEIGHTS: Record<ScoreDimension, number> = {
  deliveryRate: 0.25,
  scopeStability: 0.15,
  roadmapCoverage: 0.10,
  leadTime: 0.20,
  deploymentFrequency: 0.10,
  changeFailureRate: 0.10,
  mttr: 0.10,
};

export interface SprintDimensionScore {
  /** null = insufficient data; the dimension is excluded from the composite. */
  score: number | null;
  band?: DoraBand;
  rawValue: number | null;
  rawUnit: string;
}

export interface SprintDimensionScores {
  deliveryRate: SprintDimensionScore;
  scopeStability: SprintDimensionScore;
  roadmapCoverage: SprintDimensionScore;
  leadTime: SprintDimensionScore;
  deploymentFrequency: SprintDimensionScore;
  changeFailureRate: SprintDimensionScore;
  mttr: SprintDimensionScore;
}

export interface ScoringInput {
  // Planning
  committedCount: number;
  addedMidSprintCount: number;
  removedCount: number;
  completedInSprintCount: number;
  // Roadmap
  roadmapCoverage: number;   // 0-100 %
  totalIssues: number;       // denominator for roadmap N/A check
  // DORA — null when no data
  medianLeadTimeDays: number | null;
  deploymentsPerDay: number | null;
  changeFailureRate: number | null;
  medianMttrHours: number | null;
  // DORA bands — null when no data (mirrors numeric fields)
  leadTimeBand: DoraBand | null;
  dfBand: DoraBand | null;
  cfrBand: DoraBand | null;
  mttrBand: DoraBand | null;
}

export interface CompositeResult {
  scores: SprintDimensionScores;
  /** null when no dimension has data (composite cannot be computed). */
  compositeScore: number | null;
  /** null when compositeScore is null. */
  compositeBand: SprintReportBand | null;
  /** Dimensions that contributed to the composite (had a non-null score). */
  contributingDimensions: ScoreDimension[];
  /** Dimensions excluded as N/A (score was null). */
  excludedDimensions: ScoreDimension[];
  /** Sum of weights of contributing dimensions; in [0, 1]. */
  totalWeightApplied: number;
}

@Injectable()
export class ScoringService {
  score(input: ScoringInput): CompositeResult {
    const inScopeCount = input.committedCount + input.addedMidSprintCount - input.removedCount;
    const deliveryRate = inScopeCount > 0 ? input.completedInSprintCount / inScopeCount : 0;

    const deliveryScore = this.scoreDeliveryRate(deliveryRate, inScopeCount);
    const stabilityScore = this.scoreScopeStability(
      input.addedMidSprintCount,
      input.removedCount,
      input.committedCount,
    );
    const roadmapScore = this.scoreRoadmapCoverage(input.roadmapCoverage, input.totalIssues);
    const leadTimeScore = this.bandToScore(input.leadTimeBand);
    const dfScore = this.bandToScore(input.dfBand);
    const cfrScore = this.bandToScore(input.cfrBand);
    const mttrScore = this.bandToScore(input.mttrBand);

    const dimensionScores: Record<ScoreDimension, number | null> = {
      deliveryRate: deliveryScore,
      scopeStability: stabilityScore,
      roadmapCoverage: roadmapScore,
      leadTime: leadTimeScore,
      deploymentFrequency: dfScore,
      changeFailureRate: cfrScore,
      mttr: mttrScore,
    };

    const contributingDimensions: ScoreDimension[] = [];
    const excludedDimensions: ScoreDimension[] = [];
    let weightedSum = 0;
    let totalWeightApplied = 0;

    for (const dim of SCORE_DIMENSIONS) {
      const s = dimensionScores[dim];
      if (s === null) {
        excludedDimensions.push(dim);
      } else {
        contributingDimensions.push(dim);
        weightedSum += s * WEIGHTS[dim];
        totalWeightApplied += WEIGHTS[dim];
      }
    }

    const compositeScore =
      totalWeightApplied > 0
        ? Math.round((weightedSum / totalWeightApplied) * 10) / 10
        : null;

    const compositeBand: SprintReportBand | null =
      compositeScore === null ? null : classifyComposite(compositeScore);

    const scores: SprintDimensionScores = {
      deliveryRate: {
        score: roundOrNull(deliveryScore),
        rawValue: inScopeCount > 0 ? Math.round(deliveryRate * 1000) / 10 : null,
        rawUnit: '%',
      },
      scopeStability: {
        score: roundOrNull(stabilityScore),
        rawValue:
          input.committedCount > 0
            ? Math.round(((input.addedMidSprintCount + input.removedCount) / input.committedCount) * 1000) / 10
            : null,
        rawUnit: '% change',
      },
      roadmapCoverage: {
        score: roundOrNull(roadmapScore),
        rawValue: input.totalIssues > 0 ? Math.round(input.roadmapCoverage * 10) / 10 : null,
        rawUnit: '%',
      },
      leadTime: {
        score: leadTimeScore,
        ...(input.leadTimeBand !== null ? { band: input.leadTimeBand } : {}),
        rawValue: input.medianLeadTimeDays,
        rawUnit: 'days',
      },
      deploymentFrequency: {
        score: dfScore,
        ...(input.dfBand !== null ? { band: input.dfBand } : {}),
        rawValue:
          input.deploymentsPerDay === null
            ? null
            : Math.round(input.deploymentsPerDay * 10000) / 10000,
        rawUnit: 'per day',
      },
      changeFailureRate: {
        score: cfrScore,
        ...(input.cfrBand !== null ? { band: input.cfrBand } : {}),
        rawValue:
          input.changeFailureRate === null
            ? null
            : Math.round(input.changeFailureRate * 100) / 100,
        rawUnit: '%',
      },
      mttr: {
        score: mttrScore,
        ...(input.mttrBand !== null ? { band: input.mttrBand } : {}),
        rawValue:
          input.medianMttrHours === null
            ? null
            : Math.round(input.medianMttrHours * 100) / 100,
        rawUnit: 'hours',
      },
    };

    return {
      scores,
      compositeScore,
      compositeBand,
      contributingDimensions,
      excludedDimensions,
      totalWeightApplied: Math.round(totalWeightApplied * 10000) / 10000,
    };
  }

  /**
   * Maps a DORA band to a numeric score in [0, 100].
   * Returns null when the band itself is null (no signal).
   */
  private bandToScore(band: DoraBand | null): number | null {
    if (band === null) return null;
    switch (band) {
      case 'elite':  return 100;
      case 'high':   return 75;
      case 'medium': return 50;
      case 'low':    return 25;
    }
  }

  /**
   * Returns null (insufficient data) when inScopeCount is 0; otherwise the
   * piecewise-linear mapping from rate to a 0–100 score.
   */
  private scoreDeliveryRate(rate: number, inScopeCount: number): number | null {
    if (inScopeCount === 0) return null;
    const r = Math.max(0, Math.min(1, rate));
    if (r >= 1.0) return 100;
    if (r >= 0.8) return 75 + ((r - 0.8) / 0.2) * 25;
    if (r >= 0.5) return 25 + ((r - 0.5) / 0.3) * 50;
    return (r / 0.5) * 25;
  }

  /**
   * Returns null when committedCount is 0 (no scope → no stability signal).
   */
  private scoreScopeStability(added: number, removed: number, committed: number): number | null {
    if (committed === 0) return null;
    const ratio = (added + removed) / committed;
    if (ratio <= 0.10) return 100;
    if (ratio <= 0.25) return 75 - ((ratio - 0.10) / 0.15) * 25;
    if (ratio <= 0.50) return 50 - ((ratio - 0.25) / 0.25) * 25;
    return Math.max(0, 25 - ((ratio - 0.50) / 0.50) * 25);
  }

  /**
   * Returns null when totalIssues is 0 (no roadmap-eligible issues in sprint).
   */
  private scoreRoadmapCoverage(coverage: number, totalIssues: number): number | null {
    if (totalIssues === 0) return null;
    const c = Math.max(0, Math.min(100, coverage));
    if (c >= 80) return 100;
    if (c >= 50) return 50 + ((c - 50) / 30) * 50;
    return (c / 50) * 50;
  }
}

function roundOrNull(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}
