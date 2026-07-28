import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiParam } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';
import { SessionOnly } from '../auth/decorators/session-only.decorator.js';
import type { TokenPayload } from '../auth/auth.service.js';

/**
 * API-key management. All routes are @SessionOnly() — they require a browser
 * session and reject API-key auth, so a key cannot mint or enumerate keys
 * (proposal 0075).
 */
@ApiTags('api-keys')
@SessionOnly()
@Controller('api/keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  private currentUser(req: Request): TokenPayload {
    const user = (req as unknown as { authUser?: TokenPayload }).authUser;
    if (!user) throw new UnauthorizedException();
    return user;
  }

  @ApiOperation({ summary: 'Create an API key (raw key returned once)' })
  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() dto: CreateApiKeyDto) {
    const user = this.currentUser(req);
    return this.apiKeysService.create(user.sub, dto.name);
  }

  @ApiOperation({ summary: "List the caller's API keys (metadata only)" })
  @Get()
  async list(@Req() req: Request) {
    const user = this.currentUser(req);
    return this.apiKeysService.listForUser(user.sub);
  }

  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiParam({ name: 'id', description: 'API key id' })
  @Delete(':id')
  @HttpCode(200)
  async revoke(@Req() req: Request, @Param('id') id: string) {
    const user = this.currentUser(req);
    await this.apiKeysService.revoke(user.sub, id);
    return { ok: true };
  }
}
