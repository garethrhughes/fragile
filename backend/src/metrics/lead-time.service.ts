import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  BoardConfig,
} from '../database/entities/index.js';
import { classifyLeadTime, type DoraBand } from './dora-bands.js';

export interface LeadTimeResult {
  boardId: string;
  medianDays: number;
  p95Days: number;
  band: DoraBand;
  sampleSize: number;
}

@Injectable()
export class LeadTimeService {
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
  ): Promise<LeadTimeResult> {
    const config = await this.boardConfigRepo.findOne({
      where: { boardId },
    });
    const doneStatuses = config?.doneStatusNames ?? [
      'Done',
      'Closed',
      'Released',
    ];
    const isKanban = config?.boardType === 'kanban';

    // Get all issues for this board
    const issues = await this.issueRepo.find({
      where: { boardId },
    });

    if (issues.length === 0) {
      return {
        boardId,
        medianDays: 0,
        p95Days: 0,
        band: classifyLeadTime(0),
        sampleSize: 0,
      };
    }

    const issueKeys = issues.map((i) => i.key);

    // Fetch all status changelogs in bulk for these issues
    const changelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: issueKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Group changelogs by issue key
    const changelogsByIssue = new Map<string, JiraChangelog[]>();
    for (const cl of changelogs) {
      const list = changelogsByIssue.get(cl.issueKey) ?? [];
      list.push(cl);
      changelogsByIssue.set(cl.issueKey, list);
    }

    // Pre-fetch version release dates for fixVersion lead time
    const versionNames = [
      ...new Set(
        issues.map((i) => i.fixVersion).filter((v): v is string => v !== null),
      ),
    ];
    const versions =
      versionNames.length > 0
        ? await this.versionRepo.find({
            where: { name: In(versionNames), projectKey: boardId },
          })
        : [];
    const versionDateMap = new Map(
      versions
        .filter((v) => v.releaseDate !== null)
        .map((v) => [v.name, v.releaseDate as Date]),
    );

    const leadTimeDays: number[] = [];

    for (const issue of issues) {
      const issueLogs = changelogsByIssue.get(issue.key) ?? [];

      // Determine start time
      let startTime: Date;
      if (isKanban) {
        // For Kanban: cycle time starts at first "In Progress" transition
        const inProgressTransition = issueLogs.find(
          (cl) => cl.toValue === 'In Progress',
        );
        if (!inProgressTransition) continue;
        startTime = inProgressTransition.changedAt;
      } else {
        // For Scrum: lead time starts at issue creation
        startTime = issue.createdAt;
      }

      // Determine end time: first done/released transition in the period
      const doneTransition = issueLogs.find(
        (cl) =>
          doneStatuses.includes(cl.toValue ?? '') &&
          cl.changedAt >= startDate &&
          cl.changedAt <= endDate,
      );

      let endTime: Date | null = null;

      if (doneTransition) {
        endTime = doneTransition.changedAt;
      } else if (issue.fixVersion) {
        // Fallback: use version release date
        const releaseDate = versionDateMap.get(issue.fixVersion);
        if (
          releaseDate &&
          releaseDate >= startDate &&
          releaseDate <= endDate
        ) {
          endTime = releaseDate;
        }
      }

      if (!endTime) continue;

      const days =
        (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 0) {
        leadTimeDays.push(days);
      }
    }

    if (leadTimeDays.length === 0) {
      return {
        boardId,
        medianDays: 0,
        p95Days: 0,
        band: classifyLeadTime(0),
        sampleSize: 0,
      };
    }

    leadTimeDays.sort((a, b) => a - b);
    const median = percentile(leadTimeDays, 50);
    const p95 = percentile(leadTimeDays, 95);

    return {
      boardId,
      medianDays: round2(median),
      p95Days: round2(p95),
      band: classifyLeadTime(median),
      sampleSize: leadTimeDays.length,
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (index - lower) * (sorted[upper] - sorted[lower]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
