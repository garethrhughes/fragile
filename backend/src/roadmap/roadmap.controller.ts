import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard.js';
import { RoadmapService } from './roadmap.service.js';
import { RoadmapAccuracyQueryDto } from './dto/roadmap-accuracy-query.dto.js';
import { CreateRoadmapConfigDto } from './dto/create-roadmap-config.dto.js';

@ApiTags('roadmap')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard)
@Controller('api/roadmap')
export class RoadmapController {
  constructor(private readonly roadmapService: RoadmapService) {}

  @ApiOperation({
    summary:
      'Get roadmap accuracy metrics per sprint or quarter. For Kanban boards, issues are bucketed by the quarter they were first pulled off the backlog.',
  })
  @Get('accuracy')
  async getAccuracy(@Query() query: RoadmapAccuracyQueryDto) {
    return this.roadmapService.getAccuracy(query.boardId, query.sprintId, query.quarter, query.week, query.weekMode);
  }

  @ApiOperation({ summary: 'List all JPD roadmap config entries' })
  @Get('configs')
  async getConfigs() {
    return this.roadmapService.getConfigs();
  }

  @ApiOperation({ summary: 'Add a JPD project key to sync' })
  @Post('configs')
  async createConfig(@Body() dto: CreateRoadmapConfigDto) {
    return this.roadmapService.createConfig(dto.jpdKey, dto.description);
  }

  @ApiOperation({ summary: 'Remove a JPD roadmap config by id' })
  @ApiParam({ name: 'id', description: 'Numeric roadmap config id' })
  @Delete('configs/:id')
  async deleteConfig(@Param('id', ParseIntPipe) id: number) {
    return this.roadmapService.deleteConfig(id);
  }

  @ApiOperation({ summary: 'Trigger an immediate roadmap sync' })
  @Post('sync')
  async triggerSync() {
    return this.roadmapService.syncRoadmaps();
  }
}
