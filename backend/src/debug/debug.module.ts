/**
 * DebugModule — admin-only read-only ticket inspection view (ADR 0076).
 *
 * Isolated feature module; reads the Postgres mirror only (no live Jira, no
 * schema change). Can be removed without affecting any other module.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  JiraIssue,
  JiraChangelog,
  JiraIssueSprint,
  JiraSprint,
  JiraIssueLink,
  JpdIdea,
} from '../database/entities/index.js';
import { DebugController } from './debug.controller.js';
import { DebugService } from './debug.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JiraIssue,
      JiraChangelog,
      JiraIssueSprint,
      JiraSprint,
      JiraIssueLink,
      JpdIdea,
    ]),
  ],
  controllers: [DebugController],
  providers: [DebugService],
})
export class DebugModule {}
