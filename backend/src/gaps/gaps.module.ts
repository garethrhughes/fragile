import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  JiraIssue,
  JiraIssueSprint,
  JiraSprint,
  BoardConfig,
  JiraChangelog,
} from '../database/entities/index.js';
import { GapsController } from './gaps.controller.js';
import { GapsService } from './gaps.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([JiraIssue, JiraIssueSprint, JiraSprint, BoardConfig, JiraChangelog]),
  ],
  controllers: [GapsController],
  providers: [GapsService],
  exports: [GapsService],
})
export class GapsModule {}
