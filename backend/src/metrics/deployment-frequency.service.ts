import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
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

export interface DeploymentFrequencyResult {
  boardId: string;
  totalDeployments: number;
  deploymentsPerDay: number;
  band: DoraBand;
  periodDays: number;
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

    // C-4: Primary path — count distinct release DAYS (not issue count).
    // DORA definition: one deployment = one release event.
    // Multiple versions shipped on the same calendar day = one deployment event.
    const releasedVersions = await this.versionRepo.find({
      where: {
        projectKey: boardId,
        released: true,
        releaseDate: Between(startDate, endDate),
      },
    });

    const releaseDays = new Set(
      releasedVersions
        .filter((v) => v.releaseDate != null)
        .map((v) => v.releaseDate!.toISOString().split('T')[0]),
    );
    const versionDeployments = releaseDays.size;

    // C-4: Fallback path — issues with NO fixVersion that transitioned to a done
    // status in the period.  Count distinct TRANSITION DAYS (not distinct issues).
    // A day on which the team closed work = one deployment event.
    const allBoardIssues = (await this.issueRepo.find({
      where: { boardId },
      select: ['key', 'issueType', 'fixVersion'],
    })).filter((i) => isWorkItem(i.issueType));

    const noVersionKeys = allBoardIssues
      .filter((i) => !i.fixVersion)
      .map((i) => i.key);

    let fallbackDeployments = 0;
    if (noVersionKeys.length > 0) {
      const rows = await this.changelogRepo
        .createQueryBuilder('cl')
        .select(`DATE(cl."changedAt") AS "transitionDay"`)
        .where('cl.issueKey IN (:...keys)', { keys: noVersionKeys })
        .andWhere('cl.field = :field', { field: 'status' })
        .andWhere('cl.toValue IN (:...statuses)', { statuses: doneStatuses })
        .andWhere('cl.changedAt BETWEEN :start AND :end', {
          start: startDate,
          end: endDate,
        })
        .groupBy('"transitionDay"')
        .getRawMany<{ transitionDay: string }>();
      fallbackDeployments = rows.length;
    }

    const totalDeployments = versionDeployments + fallbackDeployments;

    const periodMs = endDate.getTime() - startDate.getTime();
    const periodDays = Math.max(periodMs / (1000 * 60 * 60 * 24), 1);
    const deploymentsPerDay = totalDeployments / periodDays;

    return {
      boardId,
      totalDeployments,
      deploymentsPerDay,
      band: classifyDeploymentFrequency(deploymentsPerDay),
      periodDays: Math.round(periodDays),
    };
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

    // Primary path: distinct release days within the period
    const releaseDays = new Set(
      slice.versions
        .filter(
          (v) =>
            v.releaseDate != null &&
            v.releaseDate >= startDate &&
            v.releaseDate <= endDate,
        )
        .map((v) => v.releaseDate!.toISOString().split('T')[0]),
    );
    const versionDeployments = releaseDays.size;

    // Fallback: issues with no fixVersion, distinct done-transition days in period
    const noVersionKeys = new Set(
      slice.issues.filter((i) => !i.fixVersion).map((i) => i.key),
    );
    const fallbackDays = new Set<string>();
    for (const cl of slice.changelogs) {
      if (
        noVersionKeys.has(cl.issueKey) &&
        doneStatuses.includes(cl.toValue ?? '') &&
        cl.changedAt >= startDate &&
        cl.changedAt <= endDate
      ) {
        fallbackDays.add(cl.changedAt.toISOString().split('T')[0]);
      }
    }
    const fallbackDeployments = fallbackDays.size;

    const totalDeployments = versionDeployments + fallbackDeployments;
    const periodMs = endDate.getTime() - startDate.getTime();
    const periodDays = Math.max(periodMs / (1000 * 60 * 60 * 24), 1);
    const deploymentsPerDay = totalDeployments / periodDays;

    return {
      boardId: slice.boardId,
      totalDeployments,
      deploymentsPerDay,
      band: classifyDeploymentFrequency(deploymentsPerDay),
      periodDays: Math.round(periodDays),
    };
  }
}
