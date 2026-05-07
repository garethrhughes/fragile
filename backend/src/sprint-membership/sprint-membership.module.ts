import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SprintMembershipService } from './sprint-membership.service.js';
import {
  JiraSprint,
  JiraIssueSprint,
  JiraChangelog,
} from '../database/entities/index.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([JiraSprint, JiraIssueSprint, JiraChangelog]),
  ],
  providers: [SprintMembershipService],
  exports: [SprintMembershipService],
})
export class SprintMembershipModule {}
