import { Controller, Post, Get, HttpCode, HttpStatus, Res, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';
import { SyncService } from './sync.service.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { TriggerSyncQueryDto } from './dto/trigger-sync-query.dto.js';

@ApiTags('sync')
@Controller('api/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @ApiOperation({
    summary:
      'Trigger a sync of all boards (fire-and-forget). Use ?mode=incremental ' +
      'to fetch only issues changed since the last successful sync; defaults to full.',
  })
  @ApiQuery({ name: 'mode', enum: ['full', 'incremental'], required: false })
  @UseGuards(AdminGuard)
  @Post()
  @HttpCode(202)
  triggerSync(
    @Res({ passthrough: true }) res: Response,
    @Query() query: TriggerSyncQueryDto,
  ) {
    if (this.syncService.isSyncRunning) {
      res.status(HttpStatus.CONFLICT);
      return { status: 'conflict', message: 'A sync is already in progress.' };
    }

    const mode = query.mode ?? 'full';

    // Run in background — do not await. A full sync across all boards takes
    // several minutes (changelog fetches per issue) and will exceed the
    // CloudFront 60-second origin timeout if awaited synchronously.
    this.syncService.syncAll(mode).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // SyncService already logs per-board failures; this catches unexpected
      // top-level errors (e.g. DB connection lost before syncAll starts).
      console.error(`[SyncController] syncAll() rejected unexpectedly: ${msg}`);
    });
    return {
      status: 'accepted',
      message: `${mode} sync started. Poll /api/sync/status for progress.`,
    };
  }

  @ApiOperation({ summary: 'Get sync status per board' })
  @Get('status')
  async getStatus() {
    return this.syncService.getStatus();
  }
}
