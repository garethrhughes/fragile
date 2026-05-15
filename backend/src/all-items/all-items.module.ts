/**
 * AllItemsModule — weekly cross-board activity report.
 *
 * NOTE: Bespoke MyPass-only report (feature 0012, proposal 0062).
 * Fully isolated module. Can be deleted without affecting any other module.
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BoardConfig,
  JiraIssue,
  JiraChangelog,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
  RoadmapConfig,
} from '../database/entities/index.js';
import { SprintMembershipModule } from '../sprint-membership/sprint-membership.module.js';
import { AllItemsController } from './all-items.controller.js';
import { AllItemsService } from './all-items.service.js';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      BoardConfig,
      JiraIssue,
      JiraChangelog,
      JiraSprint,
      JiraIssueLink,
      JpdIdea,
      RoadmapConfig,
    ]),
    SprintMembershipModule,
  ],
  controllers: [AllItemsController],
  providers: [AllItemsService],
})
export class AllItemsModule {}
