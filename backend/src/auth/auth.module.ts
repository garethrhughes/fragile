import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ApiKeyStrategy } from './api-key.strategy.js';

@Module({
  imports: [PassportModule],
  providers: [ApiKeyStrategy],
  exports: [ApiKeyStrategy],
})
export class AuthModule {}
