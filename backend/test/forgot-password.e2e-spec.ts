import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  FORGOT_PASSWORD_MESSAGE,
  PasswordResetController,
} from '../src/auth/password-reset.controller';
import { PasswordResetService } from '../src/auth/password-reset.service';
import { UserContextCache } from '../src/auth/user-context.cache';
import { GLOBAL_GUARDS } from '../src/common/guards/global-guards';
import { User } from '../src/users/user.entity';

// The real global guard chain (Throttler → Supabase → Tenant → Roles) in front
// of POST /auth/forgot-password (BE-08); only the reset service is stubbed.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

describe('POST /auth/forgot-password (e2e, BE-08)', () => {
  let app: INestApplication<App>;
  const resetRequest = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    resetRequest.mockClear();
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
      controllers: [PasswordResetController],
      providers: [
        ...GLOBAL_GUARDS.map((guard) => ({
          provide: APP_GUARD,
          useClass: guard,
        })),
        { provide: PasswordResetService, useValue: { request: resetRequest } },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'x', get: () => undefined },
        },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        UserContextCache,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('works without a token and answers the same for any e-mail', async () => {
    for (const email of ['ana@exemplo.dev', 'ninguem@exemplo.dev']) {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email })
        .expect(200);
      expect(res.body).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    }
    expect(resetRequest.mock.calls).toEqual([
      ['ana@exemplo.dev'],
      ['ninguem@exemplo.dev'],
    ]);
  });

  it('400s an invalid e-mail or extra fields', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'nao-e-email' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'ana@exemplo.dev', role: 'dono' })
      .expect(400);
    expect(resetRequest).not.toHaveBeenCalled();
  });

  it('allows 5 requests per minute per IP, then 429', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: `u${i}@exemplo.dev` })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'u5@exemplo.dev' })
      .expect(429);
    expect(resetRequest).toHaveBeenCalledTimes(5);
  });
});
