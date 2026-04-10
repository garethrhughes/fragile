import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard.js';
import { MetricsService } from './metrics.service.js';
import { MetricsQueryDto } from './dto/metrics-query.dto.js';

@ApiTags('metrics')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard)
@Controller('api/metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @ApiOperation({
    summary: 'Get combined DORA metrics for all or a specific board',
  })
  @Get('dora')
  async getDora(@Query() query: MetricsQueryDto) {
    return this.metricsService.getDora(query);
  }

  @ApiOperation({ summary: 'Get deployment frequency metric' })
  @Get('deployment-frequency')
  async getDeploymentFrequency(@Query() query: MetricsQueryDto) {
    return this.metricsService.getDeploymentFrequency(query);
  }

  @ApiOperation({ summary: 'Get lead time metric' })
  @Get('lead-time')
  async getLeadTime(@Query() query: MetricsQueryDto) {
    return this.metricsService.getLeadTime(query);
  }

  @ApiOperation({ summary: 'Get change failure rate metric' })
  @Get('cfr')
  async getCfr(@Query() query: MetricsQueryDto) {
    return this.metricsService.getCfr(query);
  }

  @ApiOperation({ summary: 'Get mean time to recovery metric' })
  @Get('mttr')
  async getMttr(@Query() query: MetricsQueryDto) {
    return this.metricsService.getMttr(query);
  }
}
