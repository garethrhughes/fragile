import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  HttpCode,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';

const COOKIE_NAME = 'fragile.sid';

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Exchange a Google ID token for a session cookie' })
  @Public()
  @Post('google')
  @HttpCode(200)
  async googleLogin(
    @Body() body: { credential: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.credential) {
      throw new UnauthorizedException('Missing credential');
    }

    try {
      const { user, token } = await this.authService.verifyGoogleToken(body.credential);

      res.cookie(COOKIE_NAME, token, {
        ...this.authService.cookieOptions,
        maxAge: this.authService.cookieMaxAge,
      });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      if (message.includes('not allowed')) {
        throw new ForbiddenException(message);
      }
      throw new UnauthorizedException(message);
    }
  }

  @ApiOperation({ summary: 'Get current authenticated user' })
  @Get('me')
  me(@Req() req: Request) {
    // User is attached by the AuthenticatedGuard
    const user = (req as unknown as { authUser?: { sub: string; email: string; name: string; role: string; avatarUrl: string | null } }).authUser;
    if (!user) {
      throw new UnauthorizedException();
    }
    return {
      id: user.sub,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }

  @ApiOperation({ summary: 'Logout — clear the session cookie' })
  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    const { path, domain } = this.authService.cookieOptions;
    res.clearCookie(COOKIE_NAME, { path, ...(domain ? { domain } : {}) });
    return { ok: true };
  }
}
