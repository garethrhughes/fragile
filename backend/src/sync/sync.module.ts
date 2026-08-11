import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';
import { JiraModule } from '../jira/jira.module.js';
import {
  JiraSprint,
  JiraIssue,
  JiraIssueSprint,
  JiraChangelog,
  JiraVersion,
  SyncLog,
  BoardConfig,
  RoadmapConfig,
  JpdIdea,
  JiraIssueLink,
  JiraFieldConfig,
  DoraSnapshot,
  CycleTimeSnapshot,
  SupportSnapshot,
} from '../database/entities/index.js';
import { SprintReportModule } from '../sprint-report/sprint-report.module.js';
import { LambdaInvokerService } from '../lambda/lambda-invoker.service.js';
import { InProcessSnapshotService } from '../lambda/in-process-snapshot.service.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { SupportModule } from '../support/support.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JiraSprint,
      JiraIssue,
      JiraIssueSprint,
      JiraChangelog,
      JiraVersion,
      SyncLog,
      BoardConfig,
      RoadmapConfig,
      JpdIdea,
      JiraIssueLink,
      JiraFieldConfig,
      DoraSnapshot,
      CycleTimeSnapshot,
      SupportSnapshot,
    ]),
    JiraModule,
    forwardRef(() => SprintReportModule),
    MetricsModule,
    SupportModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, LambdaInvokerService, InProcessSnapshotService],
  exports: [SyncService],
})
export class SyncModule {}
