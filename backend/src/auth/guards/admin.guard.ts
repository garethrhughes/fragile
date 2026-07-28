import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { TokenPayload } from '../auth.service.js';

/**
 * Guard that restricts access to admin users only.
 * Must be used after AuthenticatedGuard has run (which attaches authUser).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as unknown as { authUser?: TokenPayload }).authUser;

    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
