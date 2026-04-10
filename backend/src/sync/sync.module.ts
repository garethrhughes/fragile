import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';
import { JiraModule } from '../jira/jira.module.js';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  JiraVersion,
  SyncLog,
  BoardConfig,
} from '../database/entities/index.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JiraSprint,
      JiraIssue,
      JiraChangelog,
      JiraVersion,
      SyncLog,
      BoardConfig,
    ]),
    JiraModule,
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
