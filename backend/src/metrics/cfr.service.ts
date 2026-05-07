import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  BoardConfig,
  JiraIssueLink,
} from '../database/entities/index.js';
import { classifyChangeFailureRate, type DoraBand } from './dora-bands.js';
import { isWorkItem } from './issue-type-filters.js';
import type { TrendDataSlice } from './trend-data-loader.service.js';
import { deriveDeploymentEvents } from './deployment-events.js';

export interface CfrResult {
  boardId: string;
  /** ADR 0051: number of deployment events (matches DeploymentFrequencyResult.totalDeployments). */
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
    @InjectRepository(JiraIssueLink)
    private readonly issueLinkRepo: Repository<JiraIssueLink>,
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
    const failureLinkTypes = config?.failureLinkTypes ?? [];

    // Load board issues (work items only — ADR 0018 enforced inside deriveDeploymentEvents).
    // select projection: omit heavy columns (summary, description) — not needed
    // for CFR classification.
    const allIssues = await this.issueRepo.find({
      where: { boardId },
      select: ['key', 'issueType', 'fixVersion', 'labels'],
    });

    // Released versions in period (primary signal — ADR 0001).
    const versions = await this.versionRepo.find({
      where: {
        projectKey: boardId,
        released: true,
        releaseDate: Between(startDate, endDate),
      },
    });

    // Status changelog entries for issues with no fixVersion in the period
    // (fallback signal).  Pre-filter to keep the result set small.
    const noVersionKeys = allIssues
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

    // ADR 0051: derive event list once; CFR denominator is event count.
    const { events, deployedIssueKeys } = deriveDeploymentEvents({
      issues: allIssues,
      versions,
      changelogs,
      doneStatuses,
      startDate,
      endDate,
    });
    const totalDeployments = events.length;

    // Classify failures among deployed issues (type/label OR-gate).
    const issueMap = new Map(allIssues.map((i) => [i.key, i]));
    const failureIssues: JiraIssue[] = [];
    for (const key of deployedIssueKeys) {
      const issue = issueMap.get(key);
      if (!issue) continue;

      const isFailureType = failureIssueTypes.includes(issue.issueType);
      const hasFailureLabel = issue.labels.some((l) =>
        failureLabels.includes(l),
      );

      if (isFailureType || hasFailureLabel) {
        failureIssues.push(issue);
      }
    }

    // AND-gate: require a causal link if failureLinkTypes is non-empty.
    let filteredFailures = failureIssues;
    if (failureLinkTypes.length > 0 && failureIssues.length > 0) {
      const failureKeys = failureIssues.map((i) => i.key);
      const causalLinks = await this.issueLinkRepo
        .createQueryBuilder('link')
        .where('link.sourceIssueKey IN (:...keys)', { keys: failureKeys })
        .andWhere('LOWER(link.linkTypeName) IN (:...types)', {
          types: failureLinkTypes.map((t) => t.toLowerCase()),
        })
        .getMany();
      const keysWithCausalLink = new Set(causalLinks.map((l) => l.sourceIssueKey));
      filteredFailures = failureIssues.filter((i) =>
        keysWithCausalLink.has(i.key),
      );
    }

    const failureCount = filteredFailures.length;
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

  /**
   * In-memory variant for the trend path.
   * Accepts pre-loaded data from TrendDataLoader and slices it to [startDate, endDate].
   * No DB calls — pure computation.
   */
  calculateFromData(
    slice: TrendDataSlice,
    startDate: Date,
    endDate: Date,
  ): CfrResult {
    const usingDefaultConfig = slice.boardConfig === null;
    const doneStatuses = slice.boardConfig?.doneStatusNames ?? ['Done', 'Closed', 'Released'];
    const failureIssueTypes = slice.boardConfig?.failureIssueTypes ?? ['Bug', 'Incident'];
    const failureLabels = slice.boardConfig?.failureLabels ?? ['regression', 'incident', 'hotfix'];
    const failureLinkTypes = slice.boardConfig?.failureLinkTypes ?? [];

    // ADR 0051: derive event list once; CFR denominator is event count.
    const { events, deployedIssueKeys } = deriveDeploymentEvents({
      issues: slice.issues,
      versions: slice.versions,
      changelogs: slice.changelogs,
      doneStatuses,
      startDate,
      endDate,
    });
    const totalDeployments = events.length;

    // Classify failures among deployed issues (type/label OR-gate).
    const issueMap = new Map(slice.issues.map((i) => [i.key, i]));
    const failureIssues: JiraIssue[] = [];
    for (const key of deployedIssueKeys) {
      const issue = issueMap.get(key);
      if (!issue) continue;
      const isFailureType = failureIssueTypes.includes(issue.issueType);
      const hasFailureLabel = issue.labels.some((l) => failureLabels.includes(l));
      if (isFailureType || hasFailureLabel) failureIssues.push(issue);
    }

    // AND-gate: require causal link if failureLinkTypes is non-empty.
    let filteredFailures = failureIssues;
    if (failureLinkTypes.length > 0 && failureIssues.length > 0) {
      const failureKeySet = new Set(failureIssues.map((i) => i.key));
      const normalizedLinkTypes = failureLinkTypes.map((t) => t.toLowerCase());
      const keysWithCausalLink = new Set(
        slice.issueLinks
          .filter(
            (link) =>
              failureKeySet.has(link.sourceIssueKey) &&
              normalizedLinkTypes.includes(link.linkTypeName.toLowerCase()),
          )
          .map((link) => link.sourceIssueKey),
      );
      filteredFailures = failureIssues.filter((i) => keysWithCausalLink.has(i.key));
    }

    const failureCount = filteredFailures.length;
    const changeFailureRate =
      totalDeployments > 0
        ? Math.round((failureCount / totalDeployments) * 10000) / 100
        : 0;

    return {
      boardId: slice.boardId,
      totalDeployments,
      failureCount,
      changeFailureRate,
      band: classifyChangeFailureRate(changeFailureRate),
      usingDefaultConfig,
    };
  }
}
