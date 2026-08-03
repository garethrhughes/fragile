/**
 * HealthcheckController — GET /api/healthcheck
 *
 * Weekly per-board engineering healthcheck (ADR 0070). Replaces the former
 * Pulse (`all-items`) report.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthcheckService } from './healthcheck.service.js';
import { HealthcheckQueryDto } from './dto/healthcheck-query.dto.js';
import type { HealthcheckResponse } from './dto/healthcheck-response.dto.js';

@ApiTags('healthcheck')
@Controller('api/healthcheck')
export class HealthcheckController {
  constructor(private readonly healthcheckService: HealthcheckService) {}

  @Get()
  @ApiOperation({
    summary: 'Weekly engineering healthcheck',
    description:
      'Returns three per-board scores (Stability, Roadmap, Support) for the given ' +
      'ISO week, computed against a shared denominator (tickets whose first-ever ' +
      'start transition fell in the week), plus a trailing 8-week trend. ' +
      'Defaults to the last completed week when `week` is omitted.',
  })
  async getHealthcheck(@Query() query: HealthcheckQueryDto): Promise<HealthcheckResponse> {
    return this.healthcheckService.getHealthcheck(query.week);
  }
}
