import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { TenantGuard } from './tenant.guard';
import { UserContextCache } from '../../auth/user-context.cache';
import { User } from '../../users/user.entity';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PASSWORD_CHANGE_EXEMPT_KEY } from '../decorators/password-change-exempt.decorator';

function makeContext(req: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    tenantId: 't1',
    externalId: 'ext1',
    role: 'analista',
    email: 'a@x.com',
    name: 'Ana',
    status: 'active',
    onboardingCompleted: true,
    mustChangePassword: false,
    tenant: { active: true },
    ...overrides,
  } as unknown as User;
}

describe('TenantGuard', () => {
  let guard: TenantGuard;
  let userRepo: { findOne: jest.Mock; update: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let cache: UserContextCache;

  const setReflector = (isPublic = false, isExempt = false) => {
    reflector.getAllAndOverride.mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? isPublic : key === PASSWORD_CHANGE_EXEMPT_KEY ? isExempt : undefined,
    );
  };

  beforeEach(() => {
    userRepo = { findOne: jest.fn(), update: jest.fn() };
    reflector = { getAllAndOverride: jest.fn() };
    cache = new UserContextCache();
    guard = new TenantGuard(
      userRepo as unknown as Repository<User>,
      reflector as unknown as Reflector,
      cache,
    );
  });

  it('allows public routes without a user', async () => {
    setReflector(true);
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true);
  });

  it('rejects when there is no authenticated user', async () => {
    setReflector();
    await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('resolves tenantId/role from the DB, never from the token (RN-01)', async () => {
    setReflector();
    userRepo.findOne.mockResolvedValue(makeUser({ tenantId: 'real-tenant', role: 'dono' }));
    const req: { user: { externalId: string; email: string; tenantId?: string; role?: string } } = {
      user: { externalId: 'ext1', email: 'a@x.com' },
    };
    await guard.canActivate(makeContext(req));
    expect(req.user.tenantId).toBe('real-tenant');
    expect(req.user.role).toBe('dono');
  });

  it('SEC-02: a disabled, onboarded user stays blocked (no auto-reactivation)', async () => {
    setReflector();
    userRepo.findOne.mockResolvedValue(makeUser({ status: 'disabled', onboardingCompleted: true }));
    const req = { user: { externalId: 'ext1', email: 'a@x.com' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('SEC-02: a disabled invitee who never finished onboarding also stays blocked', async () => {
    setReflector();
    userRepo.findOne.mockResolvedValue(makeUser({ status: 'disabled', onboardingCompleted: false }));
    const req = { user: { externalId: 'ext1', email: 'a@x.com' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('activates an invited user on first login', async () => {
    setReflector();
    userRepo.findOne.mockResolvedValue(makeUser({ status: 'invited', onboardingCompleted: false }));
    const req = { user: { externalId: 'ext1', email: 'a@x.com' } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(userRepo.update).toHaveBeenCalledWith('u1', { status: 'active' });
  });

  it('binds an unlinked account by e-mail on first login', async () => {
    setReflector();
    userRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeUser({ externalId: null, status: 'active' }));
    const req = { user: { externalId: 'ext-new', email: 'a@x.com' } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(userRepo.update).toHaveBeenCalledWith('u1', { externalId: 'ext-new' });
  });

  it('SEC-02: never binds a disabled account by e-mail', async () => {
    setReflector();
    userRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeUser({ externalId: null, status: 'disabled' }));
    const req = { user: { externalId: 'ext-new', email: 'a@x.com' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('SEC-03: blocks non-exempt routes while mustChangePassword is true', async () => {
    setReflector(false, false);
    userRepo.findOne.mockResolvedValue(makeUser({ mustChangePassword: true }));
    const req = { user: { externalId: 'ext1', email: 'a@x.com' } };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('SEC-03: allows exempt routes (change-password) while mustChangePassword is true', async () => {
    setReflector(false, true);
    userRepo.findOne.mockResolvedValue(makeUser({ mustChangePassword: true }));
    const req = { user: { externalId: 'ext1', email: 'a@x.com' } };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  describe('AUTH-09: shared cache with invalidation by userId', () => {
    const req = () => ({ user: { externalId: 'ext1', email: 'a@x.com' } });

    it('serves the second request from the cache, without the DB', async () => {
      setReflector();
      userRepo.findOne.mockResolvedValue(makeUser());
      await guard.canActivate(makeContext(req()));
      await guard.canActivate(makeContext(req()));
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
      expect(cache.get('ext1')).toMatchObject({ userId: 'u1' });
    });

    it('after invalidateUser, the next request re-reads the DB (disabled → 403 at once)', async () => {
      setReflector();
      userRepo.findOne.mockResolvedValue(makeUser());
      await guard.canActivate(makeContext(req()));

      userRepo.findOne.mockResolvedValue(makeUser({ status: 'disabled' }));
      // Still cached: the change is not visible yet...
      await expect(guard.canActivate(makeContext(req()))).resolves.toBe(true);
      // ...until the service that disabled the user invalidates it.
      cache.invalidateUser('u1');
      await expect(
        guard.canActivate(makeContext(req())),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never caches a user who must change the password', async () => {
      setReflector(false, true);
      userRepo.findOne.mockResolvedValue(
        makeUser({ mustChangePassword: true }),
      );
      await guard.canActivate(makeContext(req()));
      expect(cache.size).toBe(0);
    });
  });
});
