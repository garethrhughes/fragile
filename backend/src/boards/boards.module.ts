import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardsService } from './boards.service.js';
import { BoardsController } from './boards.controller.js';
import { BoardConfig } from '../database/entities/index.js';
import { LambdaInvokerService } from '../lambda/lambda-invoker.service.js';
import { SnapshotComputeModule } from '../snapshot/snapshot-compute.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([BoardConfig]),
    SnapshotComputeModule,
  ],
  controllers: [BoardsController],
  providers: [BoardsService, LambdaInvokerService],
  exports: [BoardsService],
})
export class BoardsModule {}
