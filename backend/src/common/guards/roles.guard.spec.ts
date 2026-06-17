import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(user?: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the route when no @Roles is declared', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(makeContext({ role: 'cliente' }))).toBe(true);
  });

  it('allows a user whose role is in the required set', () => {
    reflector.getAllAndOverride.mockReturnValue(['analista', 'dono']);
    expect(guard.canActivate(makeContext({ role: 'analista' }))).toBe(true);
  });

  it('forbids a user whose role is not in the required set', () => {
    reflector.getAllAndOverride.mockReturnValue(['analista', 'dono']);
    expect(() => guard.canActivate(makeContext({ role: 'cliente' }))).toThrow(ForbiddenException);
  });

  it('forbids when there is no authenticated user on the request', () => {
    reflector.getAllAndOverride.mockReturnValue(['analista']);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
