import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  JiraSprint,
  BoardConfig,
  JiraIssueLink,
  WorkingTimeConfigEntity,
  SupportSnapshot,
} from '../database/entities/index.js';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import { SupportSnapshotReadService } from './support-snapshot-read.service.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';
import { SprintMembershipModule } from '../sprint-membership/sprint-membership.module.js';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      JiraIssue,
      JiraChangelog,
      JiraVersion,
      JiraSprint,
      BoardConfig,
      JiraIssueLink,
      WorkingTimeConfigEntity,
      SupportSnapshot,
    ]),
    SprintMembershipModule,
  ],
  controllers: [SupportController],
  providers: [SupportService, SupportSnapshotReadService, WorkingTimeService],
  exports: [SupportService],
})
export class SupportModule {}
