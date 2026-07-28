import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedGuard } from './authenticated.guard.js';
import { AuthService } from '../auth.service.js';

describe('AuthenticatedGuard', () => {
  let guard: AuthenticatedGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let authService: { verifyToken: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    authService = { verifyToken: jest.fn() };
    guard = new AuthenticatedGuard(
      reflector as unknown as Reflector,
      authService as unknown as AuthService,
    );
  });

  function makeContext(cookies: Record<string, string> = {}): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ cookies }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('returns true when JWT cookie is valid', () => {
    authService.verifyToken.mockReturnValue({ sub: '1', email: 'a@b.com', role: 'user' });
    expect(guard.canActivate(makeContext({ 'fragile.sid': 'valid-token' }))).toBe(true);
  });

  it('throws UnauthorizedException when no cookie present', () => {
    expect(() => guard.canActivate(makeContext({}))).toThrow();
  });

  it('throws UnauthorizedException when token is invalid', () => {
    authService.verifyToken.mockReturnValue(null);
    expect(() => guard.canActivate(makeContext({ 'fragile.sid': 'bad-token' }))).toThrow();
  });

  it('skips auth check when @Public() is set', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(makeContext({}))).toBe(true);
  });
});
