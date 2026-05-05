import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupportService } from './support.service.js';
import { SupportQueryDto } from './dto/support-query.dto.js';
import type { SupportResult, SupportSummaryDto } from './dto/support-response.dto.js';

@ApiTags('support')
@Controller('api/support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  /** GET /api/support/summary?boardId=ACC,BPT&quarter=2026-Q1 */
  @ApiOperation({ summary: 'Get aggregate support ticket stats and per-board breakdown' })
  @Get('summary')
  async getSupportSummary(@Query() query: SupportQueryDto): Promise<SupportSummaryDto> {
    return this.supportService.getSupportSummary(query);
  }

  /** GET /api/support?boardId=ACC&quarter=2026-Q1 */
  @ApiOperation({ summary: 'Get support tickets and cycle time per board' })
  @Get()
  async getSupportTickets(@Query() query: SupportQueryDto): Promise<SupportResult[]> {
    return this.supportService.getSupportTickets(query);
  }
}
