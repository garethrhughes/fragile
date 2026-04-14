import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  GapsService,
  GapsResponse,
  UnplannedDoneResponse,
} from './gaps.service.js';
import { UnplannedDoneQueryDto } from './dto/unplanned-done-query.dto.js';

@ApiTags('gaps')
@Controller('api/gaps')
export class GapsController {
  constructor(private readonly gapsService: GapsService) {}

  @ApiOperation({
    summary: 'Get hygiene gaps: issues without an epic or estimate in active sprints',
  })
  @Get()
  getGaps(): Promise<GapsResponse> {
    return this.gapsService.getGaps();
  }

  @ApiOperation({
    summary:
      'Get never-boarded completions: work items resolved within the window that were never ' +
      'planned (Scrum: never in a sprint; Kanban: never entered the board workflow). ' +
      'Omit boardId (or pass boardId=all) to aggregate across all boards.',
  })
  @Get('unplanned-done')
  getUnplannedDone(
    @Query() query: UnplannedDoneQueryDto,
  ): Promise<UnplannedDoneResponse> {
    return this.gapsService.getUnplannedDone(
      query.boardId,
      query.sprintId,
      query.quarter,
    );
  }
}
