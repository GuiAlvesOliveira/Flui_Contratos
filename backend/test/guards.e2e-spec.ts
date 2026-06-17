import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { SupabaseGuard, RequestUserFull } from '../src/auth/supabase.guard';
import { TenantGuard } from '../src/common/guards/tenant.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Public } from '../src/common/decorators/public.decorator';
import { Roles } from '../src/common/decorators/roles.decorator';
import { User } from '../src/users/user.entity';

// Mock only the external auth I/O — the real guard classes run unchanged.
const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

@Controller('test')
class TestController {
  @Get('public')
  @Public()
  pub() {
    return { ok: true };
  }

  @Get('analista-only')
  @Roles('analista', 'dono')
  analistaOnly() {
    return { ok: 'analista' };
  }

  @Get('me')
  @Roles('analista', 'dono', 'cliente')
  me(@Req() req: { user: RequestUserFull }) {
    return req.user;
  }
}

function dbUser(externalId: string, role: string, id: string) {
  return {
    id,
    externalId,
    email: `${role}@x.com`,
    tenantId: 'tenant-1',
    role,
    name: role,
    active: true,
    onboardingCompleted: true,
    mustChangePassword: false,
    tenant: { active: true },
  };
}

describe('Guard chain (e2e): Supabase → Tenant → Roles', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    mockGetUser.mockImplementation((token: string) => {
      if (token === 'analista-token')
        return Promise.resolve({ data: { user: { id: 'ext-analista', email: 'an@x.com' } }, error: null });
      if (token === 'cliente-token')
        return Promise.resolve({ data: { user: { id: 'ext-cliente', email: 'cl@x.com' } }, error: null });
      return Promise.resolve({ data: { user: null }, error: { message: 'invalid token' } });
    });

    const userRepo = {
      findOne: jest.fn(({ where }: { where: { externalId?: string } }) => {
        if (where.externalId === 'ext-analista') return Promise.resolve(dbUser('ext-analista', 'analista', 'u-an'));
        if (where.externalId === 'ext-cliente') return Promise.resolve(dbUser('ext-cliente', 'cliente', 'u-cli'));
        return Promise.resolve(null);
      }),
      update: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TestController],
      providers: [
        { provide: APP_GUARD, useClass: SupabaseGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: ConfigService, useValue: { getOrThrow: () => 'x', get: () => undefined } },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets a @Public() route through with no token', () => {
    return request(app.getHttpServer()).get('/test/public').expect(200).expect({ ok: true });
  });

  it('401s a protected route when the Bearer token is missing', () => {
    return request(app.getHttpServer()).get('/test/analista-only').expect(401);
  });

  it('401s when Supabase rejects the token', () => {
    return request(app.getHttpServer())
      .get('/test/analista-only')
      .set('Authorization', 'Bearer garbage')
      .expect(401);
  });

  it('allows an analista through the full chain', () => {
    return request(app.getHttpServer())
      .get('/test/analista-only')
      .set('Authorization', 'Bearer analista-token')
      .expect(200)
      .expect({ ok: 'analista' });
  });

  it('403s a cliente on an analista-only route (RolesGuard)', () => {
    return request(app.getHttpServer())
      .get('/test/analista-only')
      .set('Authorization', 'Bearer cliente-token')
      .expect(403);
  });

  it('enriches request.user with tenantId/role resolved from the DB, not the token (RN-01)', async () => {
    const res = await request(app.getHttpServer())
      .get('/test/me')
      .set('Authorization', 'Bearer analista-token')
      .expect(200);
    expect(res.body).toMatchObject({ tenantId: 'tenant-1', role: 'analista', userId: 'u-an' });
  });
});
