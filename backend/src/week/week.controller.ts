import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard.js';
import { WeekDetailService, type WeekDetailResponse } from './week-detail.service.js';

@ApiTags('weeks')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard)
@Controller('api/weeks')
export class WeekController {
  constructor(private readonly weekDetailService: WeekDetailService) {}

  @ApiOperation({ summary: 'Get annotated ticket-level breakdown for a week (Kanban boards only)' })
  @ApiParam({ name: 'boardId', description: 'The board identifier' })
  @ApiParam({ name: 'week', description: 'ISO week in format YYYY-Www e.g. 2026-W15' })
  @Get(':boardId/:week/detail')
  async getDetail(
    @Param('boardId') boardId: string,
    @Param('week') week: string,
  ): Promise<WeekDetailResponse> {
    return this.weekDetailService.getDetail(boardId, week);
  }
}
