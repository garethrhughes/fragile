import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from './metrics.service.js';
import { CycleTimeSnapshotReadService } from './cycle-time-snapshot-read.service.js';
import { CycleTimeQueryDto } from './dto/cycle-time-query.dto.js';
import { CycleTimeTrendQueryDto } from './dto/cycle-time-trend-query.dto.js';
import { ORG_SNAPSHOT_KEY } from '../lambda/in-process-snapshot.service.js';
import type {
  CycleTimeResponse,
  CycleTimeTrendResponse,
} from './dto/cycle-time-response.dto.js';

@ApiTags('cycle-time')
@Controller('api/cycle-time')
export class CycleTimeController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly cycleTimeSnapshotReadService: CycleTimeSnapshotReadService,
  ) {}

  /**
   * GET /api/cycle-time/trend?boardId=ACC&mode=quarters&limit=8
   * Declared BEFORE the :boardId route to prevent NestJS matching "trend"
   * as a boardId path parameter.
   */
  @ApiOperation({ summary: 'Get cycle time trend across multiple periods' })
  @Get('trend')
  async getCycleTimeTrend(
    @Query() query: CycleTimeTrendQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CycleTimeTrendResponse | { status: string; message: string }> {
    // Time-period mode is served from the pre-computed window snapshot.
    if (query.mode === 'timeperiod') {
      const snapshotKey =
        query.boardId && !query.boardId.includes(',')
          ? query.boardId
          : ORG_SNAPSHOT_KEY;
      const snapshot = await this.cycleTimeSnapshotReadService.getSnapshot(
        snapshotKey,
        `trend-${query.window ?? 90}d`,
      );
      if (!snapshot) {
        res.status(202);
        return { status: 'pending', message: 'Snapshot not yet computed. Trigger a sync.' };
      }
      if (snapshot.stale) res.setHeader('X-Snapshot-Stale', 'true');
      res.setHeader('X-Snapshot-Age', String(snapshot.ageSeconds));
      return snapshot.payload as CycleTimeTrendResponse;
    }
    return this.metricsService.getCycleTimeTrend(query);
  }

  /**
   * GET /api/cycle-time/:boardId?quarter=2026-Q1
   */
  @ApiOperation({ summary: 'Get cycle time observations and percentiles for a board' })
  @Get(':boardId')
  async getCycleTime(
    @Param('boardId') boardId: string,
    @Query() query: CycleTimeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CycleTimeResponse | { status: string; message: string }> {
    // Time-period mode is served from the pre-computed window snapshot.
    if (query.window) {
      const snapshotKey = boardId && !boardId.includes(',') ? boardId : ORG_SNAPSHOT_KEY;
      const snapshot = await this.cycleTimeSnapshotReadService.getSnapshot(
        snapshotKey,
        `aggregate-${query.window}d`,
      );
      if (!snapshot) {
        res.status(202);
        return { status: 'pending', message: 'Snapshot not yet computed. Trigger a sync.' };
      }
      if (snapshot.stale) res.setHeader('X-Snapshot-Stale', 'true');
      res.setHeader('X-Snapshot-Age', String(snapshot.ageSeconds));
      return snapshot.payload as CycleTimeResponse;
    }
    return this.metricsService.getCycleTime({ ...query, boardId });
  }
}
