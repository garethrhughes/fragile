import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type TokenPayload } from '../auth.service.js';

const COOKIE_NAME = 'fragile.sid';
const IS_PUBLIC_KEY = 'isPublic';

/**
 * Global guard that verifies the JWT session cookie on every request.
 * Endpoints decorated with @Public() are exempt.
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check @Public() decorator
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }

    const payload = this.authService.verifyToken(token);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Attach user payload to request for downstream use
    (req as unknown as { authUser: TokenPayload }).authUser = payload;
    return true;
  }
}
