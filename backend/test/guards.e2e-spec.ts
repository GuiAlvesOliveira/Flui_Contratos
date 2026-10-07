import { Test, TestingModule } from '@nestjs/testing';
import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { RequestUserFull } from '../src/auth/supabase.guard';
import { GLOBAL_GUARDS } from '../src/common/guards/global-guards';
import { UserContextCache } from '../src/auth/user-context.cache';
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
    status: 'active',
    onboardingCompleted: true,
    mustChangePassword: false,
    tenant: { active: true },
  };
}

mockGetUser.mockImplementation((token: string) => {
  if (token === 'analista-token')
    return Promise.resolve({ data: { user: { id: 'ext-analista', email: 'an@x.com' } }, error: null });
  if (token === 'cliente-token')
    return Promise.resolve({ data: { user: { id: 'ext-cliente', email: 'cl@x.com' } }, error: null });
  return Promise.resolve({ data: { user: null }, error: { message: 'invalid token' } });
});

// The real global chain, in production order (GLOBAL_GUARDS = what AppModule
// registers): Throttler → Supabase → Tenant → Roles. Only the external I/O
// (Supabase getUser, the users table) is mocked.
async function buildApp(throttleLimit: number): Promise<INestApplication<App>> {
  const userRepo = {
    findOne: jest.fn(({ where }: { where: { externalId?: string } }) => {
      if (where.externalId === 'ext-analista') return Promise.resolve(dbUser('ext-analista', 'analista', 'u-an'));
      if (where.externalId === 'ext-cliente') return Promise.resolve(dbUser('ext-cliente', 'cliente', 'u-cli'));
      return Promise.resolve(null);
    }),
    update: jest.fn(),
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: throttleLimit }])],
    controllers: [TestController],
    providers: [
      ...GLOBAL_GUARDS.map((guard) => ({
        provide: APP_GUARD,
        useClass: guard,
      })),
      { provide: ConfigService, useValue: { getOrThrow: () => 'x', get: () => undefined } },
      { provide: getRepositoryToken(User), useValue: userRepo },
      UserContextCache,
    ],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  await app.init();
  return app;
}

describe('Guard chain (e2e): Throttler → Supabase → Tenant → Roles', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildApp(1000); // limit high enough not to interfere here
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

describe('Guard chain (e2e): ThrottlerGuard runs first (QA-02)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await buildApp(3); // 3 requests per minute per IP
    mockGetUser.mockClear();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lets requests under the limit go on through the whole chain', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .get('/test/analista-only')
        .set('Authorization', 'Bearer analista-token')
        .expect(200);
    }
    expect(mockGetUser).toHaveBeenCalledTimes(3);
  });

  it('429s past the limit before the token is even checked', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .get('/test/analista-only')
        .set('Authorization', 'Bearer analista-token');
    }
    mockGetUser.mockClear();
    const res = await request(app.getHttpServer())
      .get('/test/analista-only')
      .set('Authorization', 'Bearer analista-token')
      .expect(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(mockGetUser).not.toHaveBeenCalled(); // SupabaseGuard never ran
  });

  it('a throttled request without a token gets 429, not 401 (order of the chain)', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer()).get('/test/analista-only');
    }
    await request(app.getHttpServer()).get('/test/analista-only').expect(429);
  });

  it('@Public() routes are rate-limited too', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer()).get('/test/public').expect(200);
    }
    await request(app.getHttpServer()).get('/test/public').expect(429);
  });

  it('the e2e chain is the one AppModule registers, in the same order', () => {
    expect(GLOBAL_GUARDS.map((g) => g.name)).toEqual([
      'ThrottlerGuard',
      'SupabaseGuard',
      'TenantGuard',
      'RolesGuard',
    ]);
  });
});

describe('Guard chain (e2e): cache invalidation by userId (AUTH-09)', () => {
  let app: INestApplication<App>;
  let analistaStatus: string;

  beforeAll(async () => {
    const userRepo = {
      findOne: jest.fn(({ where }: { where: { externalId?: string } }) =>
        Promise.resolve(
          where.externalId === 'ext-analista'
            ? {
                ...dbUser('ext-analista', 'analista', 'u-an'),
                status: analistaStatus,
              }
            : null,
        ),
      ),
      update: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1000 }])],
      controllers: [TestController],
      providers: [
        ...GLOBAL_GUARDS.map((guard) => ({
          provide: APP_GUARD,
          useClass: guard,
        })),
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'x', get: () => undefined },
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        UserContextCache,
      ],
    }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('a disabled account is blocked on the next request once invalidated', async () => {
    const call = () =>
      request(app.getHttpServer())
        .get('/test/analista-only')
        .set('Authorization', 'Bearer analista-token');

    analistaStatus = 'active';
    await call().expect(200); // context now cached

    analistaStatus = 'disabled'; // e.g. PATCH /users/:id/status
    await call().expect(200); // stale for up to 60s without invalidation...

    app.get(UserContextCache).invalidateUser('u-an'); // what UsersService does
    await call().expect(403);
  });
});
