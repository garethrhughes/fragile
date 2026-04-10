import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  JiraIssue,
  JiraChangelog,
  BoardConfig,
} from '../database/entities/index.js';
import { classifyMTTR, type DoraBand } from './dora-bands.js';

export interface MttrResult {
  boardId: string;
  medianHours: number;
  band: DoraBand;
  incidentCount: number;
}

@Injectable()
export class MttrService {
  constructor(
    @InjectRepository(JiraIssue)
    private readonly issueRepo: Repository<JiraIssue>,
    @InjectRepository(JiraChangelog)
    private readonly changelogRepo: Repository<JiraChangelog>,
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
  ) {}

  async calculate(
    boardId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<MttrResult> {
    const config = await this.boardConfigRepo.findOne({
      where: { boardId },
    });
    const incidentIssueTypes = config?.incidentIssueTypes ?? [
      'Bug',
      'Incident',
    ];
    const recoveryStatuses = config?.recoveryStatusNames ?? [
      'Done',
      'Resolved',
    ];
    const incidentLabels = config?.incidentLabels ?? [];

    // Get incident issues for this board
    const allIssues = await this.issueRepo.find({
      where: { boardId },
    });

    const incidentIssues = allIssues.filter((issue) => {
      const isIncidentType = incidentIssueTypes.includes(issue.issueType);
      const hasIncidentLabel =
        incidentLabels.length > 0
          ? issue.labels.some((l) => incidentLabels.includes(l))
          : false;
      return isIncidentType || hasIncidentLabel;
    });

    if (incidentIssues.length === 0) {
      return {
        boardId,
        medianHours: 0,
        band: classifyMTTR(0),
        incidentCount: 0,
      };
    }

    const incidentKeys = incidentIssues.map((i) => i.key);

    // Get recovery transitions in bulk
    const recoveryChangelogs = await this.changelogRepo
      .createQueryBuilder('cl')
      .where('cl.issueKey IN (:...keys)', { keys: incidentKeys })
      .andWhere('cl.field = :field', { field: 'status' })
      .andWhere('cl.toValue IN (:...statuses)', {
        statuses: recoveryStatuses,
      })
      .andWhere('cl.changedAt BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .orderBy('cl.changedAt', 'ASC')
      .getMany();

    // Group by issue and take first recovery transition
    const firstRecoveryByIssue = new Map<string, Date>();
    for (const cl of recoveryChangelogs) {
      if (!firstRecoveryByIssue.has(cl.issueKey)) {
        firstRecoveryByIssue.set(cl.issueKey, cl.changedAt);
      }
    }

    // Calculate MTTR for each incident
    const issueMap = new Map(incidentIssues.map((i) => [i.key, i]));
    const recoveryHours: number[] = [];

    for (const [issueKey, recoveryDate] of firstRecoveryByIssue) {
      const issue = issueMap.get(issueKey);
      if (!issue) continue;

      const hours =
        (recoveryDate.getTime() - issue.createdAt.getTime()) /
        (1000 * 60 * 60);
      if (hours >= 0) {
        recoveryHours.push(hours);
      }
    }

    if (recoveryHours.length === 0) {
      return {
        boardId,
        medianHours: 0,
        band: classifyMTTR(0),
        incidentCount: 0,
      };
    }

    recoveryHours.sort((a, b) => a - b);
    const median = percentile(recoveryHours, 50);

    return {
      boardId,
      medianHours: Math.round(median * 100) / 100,
      band: classifyMTTR(median),
      incidentCount: recoveryHours.length,
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
