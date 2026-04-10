import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardConfig } from '../database/entities/index.js';
import { UpdateBoardConfigDto } from './dto/update-board-config.dto.js';

const DEFAULT_BOARDS: { boardId: string; boardType: string }[] = [
  { boardId: 'ACC', boardType: 'scrum' },
  { boardId: 'BPT', boardType: 'scrum' },
  { boardId: 'SPS', boardType: 'scrum' },
  { boardId: 'OCS', boardType: 'scrum' },
  { boardId: 'DATA', boardType: 'scrum' },
  { boardId: 'PLAT', boardType: 'kanban' },
];

@Injectable()
export class BoardsService {
  private readonly logger = new Logger(BoardsService.name);

  constructor(
    @InjectRepository(BoardConfig)
    private readonly boardConfigRepo: Repository<BoardConfig>,
  ) {}

  async getAll(): Promise<BoardConfig[]> {
    return this.boardConfigRepo.find();
  }

  async getConfig(boardId: string): Promise<BoardConfig> {
    let config = await this.boardConfigRepo.findOne({ where: { boardId } });
    if (!config) {
      config = this.boardConfigRepo.create({
        boardId,
        boardType: boardId === 'PLAT' ? 'kanban' : 'scrum',
      });
      config = await this.boardConfigRepo.save(config);
    }
    return config;
  }

  async updateConfig(
    boardId: string,
    dto: UpdateBoardConfigDto,
  ): Promise<BoardConfig> {
    let config = await this.getConfig(boardId);
    config = this.boardConfigRepo.merge(config, dto);
    return this.boardConfigRepo.save(config);
  }

  async seedDefaults(): Promise<BoardConfig[]> {
    const seeded: BoardConfig[] = [];

    for (const { boardId, boardType } of DEFAULT_BOARDS) {
      const existing = await this.boardConfigRepo.findOne({
        where: { boardId },
      });
      if (!existing) {
        const config = this.boardConfigRepo.create({ boardId, boardType });
        seeded.push(await this.boardConfigRepo.save(config));
        this.logger.log(`Seeded default config for board ${boardId}`);
      }
    }

    return seeded;
  }
}
