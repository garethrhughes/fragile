import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanningService } from './planning.service.js';
import { PlanningController } from './planning.controller.js';
import {
  JiraSprint,
  JiraIssue,
  JiraChangelog,
  BoardConfig,
} from '../database/entities/index.js';
import { SprintMembershipModule } from '../sprint-membership/sprint-membership.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([JiraSprint, JiraIssue, JiraChangelog, BoardConfig]),
    SprintMembershipModule,
  ],
  controllers: [PlanningController],
  providers: [PlanningService],
  exports: [PlanningService],
})
export class PlanningModule {}
