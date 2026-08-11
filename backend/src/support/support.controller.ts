import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { SupportService } from './support.service.js';
import { SupportSnapshotReadService } from './support-snapshot-read.service.js';
import { SupportQueryDto } from './dto/support-query.dto.js';
import { ORG_SNAPSHOT_KEY } from '../lambda/in-process-snapshot.service.js';
import type { SupportSnapshotType } from '../database/entities/index.js';
import type { SupportResult, SupportSummaryDto } from './dto/support-response.dto.js';

@ApiTags('support')
@Controller('api/support')
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly supportSnapshotReadService: SupportSnapshotReadService,
  ) {}

  /** GET /api/support/summary?boardId=ACC,BPT&quarter=2026-Q1 */
  @ApiOperation({ summary: 'Get aggregate support ticket stats and per-board breakdown' })
  @Get('summary')
  async getSupportSummary(
    @Query() query: SupportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SupportSummaryDto | { status: string; message: string }> {
    const snapshotKey =
      query.boardId && !query.boardId.includes(',')
        ? query.boardId
        : ORG_SNAPSHOT_KEY;

    // Time-period (rolling window) summary is served from the pre-computed snapshot.
    if (query.window) {
      const snapshot = await this.supportSnapshotReadService.getSnapshot(
        snapshotKey,
        `summary-${query.window}d`,
      );
      return this.serveSnapshot(snapshot, res);
    }
    // Quarter summary is served from the pre-computed snapshot (proposal 0082).
    // Sprint mode stays live.
    if (query.quarter && !query.sprintId) {
      const snapshot = await this.supportSnapshotReadService.getSnapshot(
        snapshotKey,
        `summary-${query.quarter}` as SupportSnapshotType,
      );
      return this.serveSnapshot(snapshot, res);
    }
    return this.supportService.getSupportSummary(query);
  }

  /** GET /api/support?boardId=ACC&quarter=2026-Q1 */
  @ApiOperation({ summary: 'Get support tickets and cycle time per board' })
  @Get()
  async getSupportTickets(@Query() query: SupportQueryDto): Promise<SupportResult[]> {
    // Ticket list is always live-computed (never snapshotted), including time period.
    return this.supportService.getSupportTickets(query);
  }

  private serveSnapshot(
    snapshot: { payload: object; stale: boolean; ageSeconds: number } | null,
    res: Response,
  ): SupportSummaryDto | { status: string; message: string } {
    if (!snapshot) {
      res.status(202);
      return { status: 'pending', message: 'Snapshot not yet computed. Trigger a sync.' };
    }
    if (snapshot.stale) res.setHeader('X-Snapshot-Stale', 'true');
    res.setHeader('X-Snapshot-Age', String(snapshot.ageSeconds));
    return snapshot.payload as SupportSummaryDto;
  }
}
