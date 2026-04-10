import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardsService } from './boards.service.js';
import { BoardsController } from './boards.controller.js';
import { BoardConfig } from '../database/entities/index.js';

@Module({
  imports: [TypeOrmModule.forFeature([BoardConfig])],
  controllers: [BoardsController],
  providers: [BoardsService],
  exports: [BoardsService],
})
export class BoardsModule {}
