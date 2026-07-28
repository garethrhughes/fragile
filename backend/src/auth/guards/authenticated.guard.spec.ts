import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedGuard } from './authenticated.guard.js';

function mockExecutionContext(overrides: {
  isAuthenticated?: boolean;
}): ExecutionContext {
  const request = {
    isAuthenticated: jest.fn().mockReturnValue(overrides.isAuthenticated ?? false),
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('AuthenticatedGuard', () => {
  let guard: AuthenticatedGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<Reflector>;
    guard = new AuthenticatedGuard(reflector);
  });

  it('returns true when req.isAuthenticated() returns true', () => {
    const context = mockExecutionContext({ isAuthenticated: true });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
  });

  it('returns false when req.isAuthenticated() returns false', () => {
    const context = mockExecutionContext({ isAuthenticated: false });

    const result = guard.canActivate(context);

    expect(result).toBe(false);
  });

  it('returns true when the handler has @Public() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = mockExecutionContext({ isAuthenticated: false });

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    // isAuthenticated should not matter when route is public
  });
});
