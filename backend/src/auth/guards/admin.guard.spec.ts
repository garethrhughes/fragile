import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';

function mockExecutionContext(user: unknown): ExecutionContext {
  const request = { user };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    guard = new AdminGuard();
  });

  it('returns true when req.user.role is admin', () => {
    const context = mockExecutionContext({ role: 'admin', email: 'a@b.com' });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('throws ForbiddenException when req.user.role is user', () => {
    const context = mockExecutionContext({ role: 'user', email: 'a@b.com' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when req.user is undefined', () => {
    const context = mockExecutionContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when req.user is null', () => {
    const context = mockExecutionContext(null);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
