import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity.js';
import { GoogleStrategy } from './google.strategy.js';
import { SessionSerializer } from './session.serializer.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  imports: [
    PassportModule.register({ session: true }),
    TypeOrmModule.forFeature([User]),
  ],
  controllers: [AuthController],
  providers: [GoogleStrategy, SessionSerializer, AuthService],
  exports: [AuthService],
})
export class AuthModule {}
