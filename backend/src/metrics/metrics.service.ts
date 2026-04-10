import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  DeploymentFrequencyService,
  type DeploymentFrequencyResult,
} from './deployment-frequency.service.js';
import { LeadTimeService, type LeadTimeResult } from './lead-time.service.js';
import { CfrService, type CfrResult } from './cfr.service.js';
import { MttrService, type MttrResult } from './mttr.service.js';
import { JiraSprint } from '../database/entities/index.js';
import { MetricsQueryDto } from './dto/metrics-query.dto.js';

export interface DoraMetricsResult {
  boardId: string;
  period: { start: string; end: string };
  deploymentFrequency: DeploymentFrequencyResult;
  leadTime: LeadTimeResult;
  changeFailureRate: CfrResult;
  mttr: MttrResult;
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    private readonly deploymentFrequencyService: DeploymentFrequencyService,
    private readonly leadTimeService: LeadTimeService,
    private readonly cfrService: CfrService,
    private readonly mttrService: MttrService,
    private readonly configService: ConfigService,
    @InjectRepository(JiraSprint)
    private readonly sprintRepo: Repository<JiraSprint>,
  ) {}

  async getDora(query: MetricsQueryDto): Promise<DoraMetricsResult[]> {
    let { startDate, endDate } = this.resolvePeriod(query);
    const boardIds = this.resolveBoardIds(query);

    // If sprintId is provided, resolve dates from the sprint record
    if (query.sprintId) {
      const sprint = await this.sprintRepo.findOne({
        where: { id: query.sprintId },
      });
      if (sprint?.startDate && sprint?.endDate) {
        startDate = sprint.startDate;
        endDate = sprint.endDate;
      }
    }

    const results: DoraMetricsResult[] = [];

    for (const boardId of boardIds) {
      const [deploymentFrequency, leadTime, changeFailureRate, mttr] =
        await Promise.all([
          this.deploymentFrequencyService.calculate(
            boardId,
            startDate,
            endDate,
          ),
          this.leadTimeService.calculate(boardId, startDate, endDate),
          this.cfrService.calculate(boardId, startDate, endDate),
          this.mttrService.calculate(boardId, startDate, endDate),
        ]);

      results.push({
        boardId,
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        deploymentFrequency,
        leadTime,
        changeFailureRate,
        mttr,
      });
    }

    return results;
  }

  async getDeploymentFrequency(
    query: MetricsQueryDto,
  ): Promise<DeploymentFrequencyResult[]> {
    const { startDate, endDate } = this.resolvePeriod(query);
    const boardIds = this.resolveBoardIds(query);

    return Promise.all(
      boardIds.map((id) =>
        this.deploymentFrequencyService.calculate(id, startDate, endDate),
      ),
    );
  }

  async getLeadTime(query: MetricsQueryDto): Promise<LeadTimeResult[]> {
    const { startDate, endDate } = this.resolvePeriod(query);
    const boardIds = this.resolveBoardIds(query);

    return Promise.all(
      boardIds.map((id) =>
        this.leadTimeService.calculate(id, startDate, endDate),
      ),
    );
  }

  async getCfr(query: MetricsQueryDto): Promise<CfrResult[]> {
    const { startDate, endDate } = this.resolvePeriod(query);
    const boardIds = this.resolveBoardIds(query);

    return Promise.all(
      boardIds.map((id) =>
        this.cfrService.calculate(id, startDate, endDate),
      ),
    );
  }

  async getMttr(query: MetricsQueryDto): Promise<MttrResult[]> {
    const { startDate, endDate } = this.resolvePeriod(query);
    const boardIds = this.resolveBoardIds(query);

    return Promise.all(
      boardIds.map((id) =>
        this.mttrService.calculate(id, startDate, endDate),
      ),
    );
  }

  private resolveBoardIds(query: MetricsQueryDto): string[] {
    if (query.boardId) {
      return query.boardId.split(',').map((id) => id.trim());
    }
    const boardIdsStr = this.configService.get<string>(
      'JIRA_BOARD_IDS',
      'ACC,BPT,SPS,OCS,DATA,PLAT',
    );
    return boardIdsStr.split(',').map((id) => id.trim());
  }

  private resolvePeriod(query: MetricsQueryDto): {
    startDate: Date;
    endDate: Date;
  } {
    // Quarter format: YYYY-QN
    if (query.quarter) {
      return this.quarterToDates(query.quarter);
    }

    // Sprint: look up sprint dates from DB (handled synchronously via fallback)
    if (query.sprintId) {
      // Sprint date resolution is async, handled in resolvePeriodAsync
      // For now fall through to default
    }

    // Explicit date range: YYYY-MM-DD:YYYY-MM-DD
    if (query.period && query.period.includes(':')) {
      const [start, end] = query.period.split(':');
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        return { startDate, endDate };
      }
    }

    // Default: last 90 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    return { startDate, endDate };
  }

  private quarterToDates(quarter: string): {
    startDate: Date;
    endDate: Date;
  } {
    const match = quarter.match(/^(\d{4})-Q([1-4])$/);
    if (!match) {
      // Fallback to last 90 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      return { startDate, endDate };
    }

    const year = parseInt(match[1], 10);
    const q = parseInt(match[2], 10);
    const startMonth = (q - 1) * 3;

    return {
      startDate: new Date(year, startMonth, 1),
      endDate: new Date(year, startMonth + 3, 0, 23, 59, 59, 999),
    };
  }
}
