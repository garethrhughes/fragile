import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  GapsService,
  GapsResponse,
  UnplannedDoneResponse,
} from './gaps.service.js';
import { UnplannedDoneQueryDto } from './dto/unplanned-done-query.dto.js';
import { KanbanNeverBoardedQueryDto } from './dto/kanban-never-boarded-query.dto.js';

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
      'Get unplanned done tickets: work items resolved within the window with no sprint membership at completion time. Returns 400 for Kanban boards. Omit boardId (or pass boardId=all) to aggregate across all Scrum boards.',
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

  @ApiOperation({
    summary:
      'Get Kanban never-boarded completions: work items resolved within the window that were never pulled onto the Kanban board flow. Returns 400 for Scrum boards. Omit boardId (or pass boardId=all) to aggregate across all Kanban boards.',
  })
  @Get('kanban-never-boarded')
  getKanbanNeverBoarded(
    @Query() query: KanbanNeverBoardedQueryDto,
  ): Promise<UnplannedDoneResponse> {
    return this.gapsService.getKanbanNeverBoarded(
      query.boardId,
      query.quarter,
      query.last90,
    );
  }
}
