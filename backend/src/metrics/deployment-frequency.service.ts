import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import {
  JiraIssue,
  JiraVersion,
  JiraChangelog,
  BoardConfig,
} from '../database/entities/index.js';
import {
  classifyDeploymentFrequency,
  type DoraBand,
} from './dora-bands.js';
import { isWorkItem } from './issue-type-filters.js';
import type { TrendDataSlice } from './trend-data-loader.service.js';
import {
  deriveDeploymentEvents,
  type DeploymentEvent,
} from './deployment-events.js';

export interface DeploymentFrequencyResult {
  boardId: string;
  /** ADR 0051: number of deployment events (one per release / one per first done-transition). */
  totalDeployments: number;
  deploymentsPerDay: number;
  band: DoraBand;
  periodDays: number;
  /** Optional event detail — exposed for CFR and consumers that need per-event metadata. */
  events?: readonly DeploymentEvent[];
  /** Optional set of issue keys that participated in any deployment in the period. */
  deployedIssueKeys?: ReadonlySet<string>;
}

@Injectable()
export class DeploymentFrequencyService {
  constructor(
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraVersion)
    private readonly versionRepo: Repository<JiraVersion>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
  ) {}

  async calculate(
    boardId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<DeploymentFrequencyResult> {
    const config = await this.boardConfigRepo.findOne({
      where: { boardId },
    });
    const doneStatuses = config?.doneStatusNames ?? [
      'Done',
      'Closed',
      'Released',
    ];

    // Released versions in period (primary signal — ADR 0001).
    const versions = await this.versionRepo.find({
      where: {
        projectKey: boardId,
        released: true,
        releaseDate: Between(startDate, endDate),
      },
    });

    // Board issues (work items only — ADR 0018 enforced inside deriveDeploymentEvents).
    const allBoardIssues = await this.issueRepo.find({
      where: { boardId },
      select: { key: true, issueType: true, fixVersion: true },
    });

    // Status changelog entries for issues with no fixVersion in the period
    // (fallback signal).  Pre-filter to keep the result set small.
    const noVersionKeys = allBoardIssues
      .filter((i) => isWorkItem(i.issueType) && !i.fixVersion)
      .map((i) => i.key);
    const changelogs =
      noVersionKeys.length > 0
        ? await this.changelogRepo.find({
            where: {
              issueKey: In(noVersionKeys),
              field: 'status',
              changedAt: Between(startDate, endDate),
            },
          })
        : [];

    return this.computeResult(
      boardId,
      allBoardIssues,
      versions,
      changelogs,
      doneStatuses,
      startDate,
      endDate,
    );
  }

  /**
   * In-memory variant for the trend path.
   * Accepts pre-loaded data from TrendDataLoader and slices it to [startDate, endDate].
   * No DB calls — pure computation.
   */
  calculateFromData(
    slice: TrendDataSlice,
    startDate: Date,
    endDate: Date,
  ): DeploymentFrequencyResult {
    const doneStatuses = slice.boardConfig?.doneStatusNames ?? [
      'Done',
      'Closed',
      'Released',
    ];

    return this.computeResult(
      slice.boardId,
      slice.issues,
      slice.versions,
      slice.changelogs,
      doneStatuses,
      startDate,
      endDate,
    );
  }

  /**
   * Shared computation: derive events via deriveDeploymentEvents, then
   * compute totals, per-day rate, and band.  ADR 0051: totalDeployments
   * is the number of events, not distinct days.
   */
  private computeResult(
    boardId: string,
    issues: readonly JiraIssue[],
    versions: readonly JiraVersion[],
    changelogs: readonly JiraChangelog[],
    doneStatuses: readonly string[],
    startDate: Date,
    endDate: Date,
  ): DeploymentFrequencyResult {
    const { events, deployedIssueKeys } = deriveDeploymentEvents({
      issues,
      versions,
      changelogs,
      doneStatuses,
      startDate,
      endDate,
    });

    const totalDeployments = events.length;
    const periodMs = endDate.getTime() - startDate.getTime();
    const periodDays = Math.max(periodMs / (1000 * 60 * 60 * 24), 1);
    const deploymentsPerDay = totalDeployments / periodDays;

    return {
      boardId,
      totalDeployments,
      deploymentsPerDay,
      band: classifyDeploymentFrequency(deploymentsPerDay),
      periodDays: Math.round(periodDays),
      events,
      deployedIssueKeys,
    };
  }
}
