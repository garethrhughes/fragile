import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedGuard } from './authenticated.guard.js';
import { AuthService } from '../auth.service.js';
import { ApiKeysService } from '../../api-keys/api-keys.service.js';
import type { User } from '../../database/entities/user.entity.js';

describe('AuthenticatedGuard', () => {
  let guard: AuthenticatedGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let authService: { verifyToken: jest.Mock };
  let apiKeysService: { verify: jest.Mock };

  beforeEach(() => {
    // Default: not public, not session-only
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    authService = { verifyToken: jest.fn() };
    apiKeysService = { verify: jest.fn() };
    guard = new AuthenticatedGuard(
      reflector as unknown as Reflector,
      authService as unknown as AuthService,
      apiKeysService as unknown as ApiKeysService,
    );
  });

  function makeContext(opts: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
  } = {}): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ cookies: opts.cookies ?? {}, headers: opts.headers ?? {} }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('allows a valid session cookie', async () => {
    authService.verifyToken.mockReturnValue({ sub: '1', email: 'a@b.com', role: 'user' });
    await expect(
      guard.canActivate(makeContext({ cookies: { 'fragile.sid': 'valid' } })),
    ).resolves.toBe(true);
  });

  it('allows a valid Bearer API key when no session', async () => {
    apiKeysService.verify.mockResolvedValue({
      id: 'u1',
      email: 'a@b.com',
      name: 'A',
      role: 'user',
      avatarUrl: null,
    } as User);
    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer frg_abc' } })),
    ).resolves.toBe(true);
    expect(apiKeysService.verify).toHaveBeenCalledWith('frg_abc');
  });

  it('rejects when neither cookie nor key present', async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toThrow();
  });

  it('rejects an invalid/revoked API key', async () => {
    apiKeysService.verify.mockResolvedValue(null);
    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer frg_bad' } })),
    ).rejects.toThrow();
  });

  it('rejects an API key on a @SessionOnly() route', async () => {
    // First getAllAndOverride call = isPublic (false); second = sessionOnly (true)
    reflector.getAllAndOverride
      .mockReturnValueOnce(false) // isPublic
      .mockReturnValueOnce(true); // sessionOnly
    apiKeysService.verify.mockResolvedValue({ id: 'u1', role: 'admin' } as User);
    await expect(
      guard.canActivate(makeContext({ headers: { authorization: 'Bearer frg_abc' } })),
    ).rejects.toThrow();
    expect(apiKeysService.verify).not.toHaveBeenCalled();
  });

  it('skips auth for @Public() routes', async () => {
    reflector.getAllAndOverride.mockReturnValue(true); // isPublic
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true);
  });

  it('populates authUser with the key owner role for AdminGuard to use', async () => {
    apiKeysService.verify.mockResolvedValue({
      id: 'admin1',
      email: 'admin@b.com',
      name: 'Admin',
      role: 'admin',
      avatarUrl: null,
    } as User);
    const req = { cookies: {}, headers: { authorization: 'Bearer frg_admin' } } as unknown as {
      authUser?: { role: string };
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx);
    expect(req.authUser?.role).toBe('admin');
  });
});
