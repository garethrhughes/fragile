import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type TokenPayload } from '../auth.service.js';
import { ApiKeysService } from '../../api-keys/api-keys.service.js';
import { SESSION_ONLY_KEY } from '../decorators/session-only.decorator.js';

const COOKIE_NAME = 'fragile.sid';
const IS_PUBLIC_KEY = 'isPublic';

/**
 * Global guard. A request is authenticated if it presents EITHER:
 *   1. a valid JWT session cookie (Google SSO), OR
 *   2. a valid `Authorization: Bearer <api-key>` (proposal 0075).
 *
 * @Public() routes skip auth entirely. @SessionOnly() routes accept only the
 * session cookie (API keys are rejected) — used for key management so a key
 * cannot mint further keys.
 *
 * In all cases `req.authUser` is populated with { sub, email, name, role }.
 */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const sessionOnly = this.reflector.getAllAndOverride<boolean>(SESSION_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<Request>();

    // 1. Session cookie (JWT)
    const cookieToken = req.cookies?.[COOKIE_NAME];
    if (cookieToken) {
      const payload = this.authService.verifyToken(cookieToken);
      if (payload) {
        (req as unknown as { authUser: TokenPayload }).authUser = payload;
        return true;
      }
    }

    // 2. API key (Bearer) — not allowed on session-only routes
    if (!sessionOnly) {
      const bearer = this.extractBearer(req);
      if (bearer) {
        const user = await this.apiKeysService.verify(bearer);
        if (user) {
          (req as unknown as { authUser: TokenPayload }).authUser = {
            sub: user.id,
            email: user.email,
            name: user.name,
            role: user.role as 'user' | 'admin',
            avatarUrl: user.avatarUrl ?? null,
          };
          return true;
        }
      }
    }

    throw new UnauthorizedException('Not authenticated');
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header)) return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value.trim();
  }
}
