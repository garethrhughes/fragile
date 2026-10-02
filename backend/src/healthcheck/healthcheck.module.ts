/**
 * HealthcheckModule — weekly engineering healthcheck report (ADR 0070).
 *
 * Replaces the former AllItemsModule (Pulse). Isolated feature module; reuses
 * SprintMembershipService, the shared support classifier, and roadmap
 * classification helpers.
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
import { HealthcheckController } from './healthcheck.controller.js';
import { HealthcheckService } from './healthcheck.service.js';

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
  controllers: [HealthcheckController],
  providers: [HealthcheckService],
})
export class HealthcheckModule {}
