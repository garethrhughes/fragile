import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import { User } from '../database/entities/user.entity.js';

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google')
  googleLogin(): void {
    // Passport redirects to Google — this method body is never reached.
  }

  @ApiOperation({ summary: 'Google OAuth callback' })
  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const profile = req.user as unknown as {
      email: string;
      name: string;
      avatarUrl: string | null;
    };

    const user = await this.authService.validateAndUpsertUser(profile);

    await new Promise<void>((resolve, reject) => {
      req.login(user, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    res.redirect(frontendUrl);
  }

  @ApiOperation({ summary: 'Get current authenticated user' })
  @Get('me')
  me(@Req() req: Request) {
    const user = req.user as User | undefined;
    if (!user) {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }

  @ApiOperation({ summary: 'Logout and destroy session' })
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: boolean }> {
    await new Promise<void>((resolve, reject) => {
      req.logout((err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.clearCookie('connect.sid');
    return { ok: true };
  }
}
