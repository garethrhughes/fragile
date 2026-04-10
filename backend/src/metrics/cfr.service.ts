import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  BoardConfig,
} from '../database/entities/index.js';
import { classifyChangeFailureRate, type DoraBand } from './dora-bands.js';

export interface CfrResult {
  boardId: string;
  totalDeployments: number;
  failureCount: number;
  changeFailureRate: number;
  band: DoraBand;
  /** True when no BoardConfig row exists for this board and hardcoded defaults are in use. */
  usingDefaultConfig: boolean;
}

@Injectable()
export class CfrService {
  constructor(
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(JiraVersion)
    private readonly versionRepo: Repository<JiraVersion>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
  ) {}

  async calculate(
    boardId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<CfrResult> {
    const config = await this.boardConfigRepo.findOne({
      where: { boardId },
    });
    const usingDefaultConfig = config === null;
    const doneStatuses = config?.doneStatusNames ?? [
      'Done',
      'Closed',
      'Released',
    ];
    const failureIssueTypes = config?.failureIssueTypes ?? [
      'Bug',
      'Incident',
    ];
    const failureLabels = config?.failureLabels ?? [
      'regression',
      'incident',
      'hotfix',
    ];

    // Count total deployments (issues that reached done in the period)
    const allIssues = await this.issueRepo.find({
      where: { boardId },
    });

    if (allIssues.length === 0) {
      return {
        boardId,
        totalDeployments: 0,
        failureCount: 0,
        changeFailureRate: 0,
        band: classifyChangeFailureRate(0),
        usingDefaultConfig,
      };
    }

    const issueKeys = allIssues.map((i) => i.key);

    // Get done transitions in period
    const doneTransitions = await this.changelogRepo
      .createQueryBuilder('cl')
      .select('DISTINCT cl.issueKey', 'issueKey')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .andWhere('cl.toValue IN (:...statuses)', { statuses: doneStatuses })
      .andWhere('cl.changedAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .getRawMany<{ issueKey: string }>();

    // Also count version-based deployments
    const releasedVersions = await this.versionRepo.find({
      where: {
        projectKey: boardId,
        released: true,
        releaseDate: Between(startDate, endDate),
      },
    });
    const versionNames = releasedVersions.map((v) => v.name);

    const versionIssueKeys =
      versionNames.length > 0
        ? (
            await this.issueRepo.find({
              where: { boardId, fixVersion: In(versionNames) },
              select: ['key'],
            })
          ).map((i) => i.key)
        : [];

    // Union of deployed issue keys
    const deployedKeys = new Set([
      ...doneTransitions.map((t) => t.issueKey),
      ...versionIssueKeys,
    ]);
    const totalDeployments = deployedKeys.size;

    // Count failure issues among deployed
    const issueMap = new Map(allIssues.map((i) => [i.key, i]));
    let failureCount = 0;

    for (const key of deployedKeys) {
      const issue = issueMap.get(key);
      if (!issue) continue;

      const isFailureType = failureIssueTypes.includes(issue.issueType);
      const hasFailureLabel = issue.labels.some((l) =>
        failureLabels.includes(l),
      );

      if (isFailureType || hasFailureLabel) {
        failureCount++;
      }
    }

    const changeFailureRate =
      totalDeployments > 0
        ? Math.round((failureCount / totalDeployments) * 10000) / 100
        : 0;

    return {
      boardId,
      totalDeployments,
      failureCount,
      changeFailureRate,
      band: classifyChangeFailureRate(changeFailureRate),
      usingDefaultConfig,
    };
  }
}
