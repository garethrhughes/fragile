import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnapshotComputeService } from './snapshot-compute.service.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { SupportModule } from '../support/support.module.js';
import {
  BoardConfig,
  DoraSnapshot,
  CycleTimeSnapshot,
  SupportSnapshot,
  JiraSprint,
} from '../database/entities/index.js';

/**
 * SnapshotComputeModule
 *
 * The single home of snapshot computation (proposal 0084). Provides
 * SnapshotComputeService, which both the in-process path (via
 * LambdaInvokerService fallback) and the prod Lambda entrypoint
 * (snapshot.handler bootstraps this module) resolve and call — guaranteeing one
 * implementation and identical snapshot rows across environments.
 */
@Module({
  imports: [
    MetricsModule,
    SupportModule,
    TypeOrmModule.forFeature([
      BoardConfig,
      DoraSnapshot,
      CycleTimeSnapshot,
      SupportSnapshot,
      JiraSprint,
    ]),
  ],
  providers: [SnapshotComputeService],
  exports: [SnapshotComputeService],
})
export class SnapshotComputeModule {}
