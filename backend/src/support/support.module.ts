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
} from '../database/entities/index.js';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import { WorkingTimeService } from '../metrics/working-time.service.js';

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
    ]),
  ],
  controllers: [SupportController],
  providers: [SupportService, WorkingTimeService],
  exports: [SupportService],
})
export class SupportModule {}
