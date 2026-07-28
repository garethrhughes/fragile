import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';

describe('AdminGuard', () => {
  const guard = new AdminGuard();

  function makeContext(authUser?: { sub: string; email: string; role: string }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ authUser }),
      }),
    } as unknown as ExecutionContext;
  }

  it('returns true when user is admin', () => {
    expect(guard.canActivate(makeContext({ sub: '1', email: 'a@b.com', role: 'admin' }))).toBe(true);
  });

  it('throws ForbiddenException when user role is user', () => {
    expect(() => guard.canActivate(makeContext({ sub: '1', email: 'a@b.com', role: 'user' }))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when authUser is undefined', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
