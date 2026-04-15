import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller.js';
import { YamlConfigModule } from '../yaml-config/yaml-config.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';

@Module({
  imports: [YamlConfigModule, MetricsModule],
  controllers: [ConfigController],
})
export class AppConfigModule {}
