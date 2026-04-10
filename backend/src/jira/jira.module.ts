import { Module } from '@nestjs/common';
import { JiraClientService } from './jira-client.service.js';

@Module({
  providers: [JiraClientService],
  exports: [JiraClientService],
})
export class JiraModule {}
