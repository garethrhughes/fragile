/**
 * AllItemsController — GET /api/all-items
 *
 * NOTE: Bespoke MyPass-only report (feature 0012, proposal 0062).
 * This controller is fully isolated. Do not modify to support other reports.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AllItemsService } from './all-items.service.js';
import { AllItemsQueryDto } from './dto/all-items-query.dto.js';
import type { AllItemsResponse } from './dto/all-items-response.dto.js';

@ApiTags('all-items')
@Controller('api/all-items')
export class AllItemsController {
  constructor(private readonly allItemsService: AllItemsService) {}

  @Get()
  @ApiOperation({
    summary: 'Weekly cross-board activity report (MyPass internal only)',
    description:
      'Returns started/added/completed items across all boards for the given ISO week, ' +
      'with per-board health scores and optional filtering. ' +
      'Bespoke report — not for upstreaming.',
  })
  async getAllItems(@Query() query: AllItemsQueryDto): Promise<AllItemsResponse> {
    return this.allItemsService.getAllItems(query.week, query.filter);
  }
}
