import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard.js';
import { PlanningService } from './planning.service.js';
import { PlanningQueryDto } from './dto/planning-query.dto.js';

@ApiTags('planning')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard)
@Controller('api/planning')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  @ApiOperation({
    summary:
      'Get sprint planning accuracy. Returns 400 for Kanban boards.',
  })
  @Get('accuracy')
  async getAccuracy(@Query() query: PlanningQueryDto) {
    const boardId = query.boardId ?? 'ACC';
    return this.planningService.getAccuracy(
      boardId,
      query.sprintId,
      query.quarter,
    );
  }

  @ApiOperation({ summary: 'Get available sprints for a board' })
  @Get('sprints')
  async getSprints(@Query('boardId') boardId: string) {
    return this.planningService.getSprints(boardId ?? 'ACC');
  }

  @ApiOperation({ summary: 'Get available quarters derived from sprint data' })
  @Get('quarters')
  async getQuarters() {
    return this.planningService.getQuarters();
  }
}
