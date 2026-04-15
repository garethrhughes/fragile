import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { YamlConfigService } from '../yaml-config/yaml-config.service.js';
import type { YamlSeedStatus } from '../yaml-config/yaml-config.service.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';

@ApiTags('config')
@Controller('api/config')
export class ConfigController {
  constructor(
    private readonly configService: ConfigService,
    private readonly yamlConfigService: YamlConfigService,
    private readonly workingTimeService: WorkingTimeService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Returns application-level configuration for the frontend' })
  @ApiResponse({ status: 200, description: 'App config' })
  async getConfig(): Promise<{ timezone: string; excludeWeekends: boolean }> {
    const wtEntity = await this.workingTimeService.getConfig();
    return {
      timezone: this.configService.get<string>('TIMEZONE', 'UTC'),
      excludeWeekends: wtEntity.excludeWeekends,
    };
  }

  @Get('yaml-status')
  @ApiOperation({ summary: 'Returns the result of the last YAML config seed' })
  @ApiResponse({ status: 200, description: 'YAML seed status' })
  getYamlStatus(): YamlSeedStatus {
    return this.yamlConfigService.getLastSeedStatus();
  }
}
