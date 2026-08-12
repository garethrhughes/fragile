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
} from '../database/entities/index.js';
import { SprintReportModule } from '../sprint-report/sprint-report.module.js';
import { LambdaInvokerService } from '../lambda/lambda-invoker.service.js';
import { SnapshotComputeModule } from '../snapshot/snapshot-compute.module.js';

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
    ]),
    JiraModule,
    forwardRef(() => SprintReportModule),
    SnapshotComputeModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, LambdaInvokerService],
  exports: [SyncService],
})
export class SyncModule {}
