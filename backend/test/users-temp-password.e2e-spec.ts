import { Test } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';

// BE-18: GET/POST /users/:id/temporary-password through the real controller,
// the real RolesGuard and the same ValidationPipe as main.ts. The visibility
// rules themselves are in users.service.spec.ts.
const U = '11111111-1111-4111-8111-111111111111';
const callers: Record<string, object> = {
  dono: { tenantId: 't1', userId: 'g1', role: 'dono' },
  analista: { tenantId: 't1', userId: 'an1', role: 'analista' },
  cliente: { tenantId: 't1', userId: 'c1', role: 'cliente' },
};

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user: unknown }>();
    req.user = callers[req.headers['x-as']];
    return true;
  }
}

describe('Senha temporária (e2e, BE-18)', () => {
  let app: INestApplication<App>;
  const view = {
    temporaryPassword: 'a1b2',
    createdAt: '2026-10-14T12:00:00.000Z',
  };
  const service = {
    getTemporaryPassword: jest.fn().mockResolvedValue(view),
    regenerateTemporaryPassword: jest.fn().mockResolvedValue(view),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: service },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
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

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });

  it('gestor e analista consultam e geram; o serviço recebe o id e quem pediu', async () => {
    for (const who of ['dono', 'analista']) {
      const res = await request(app.getHttpServer())
        .get(`/users/${U}/temporary-password`)
        .set('x-as', who)
        .expect(200);
      expect(res.body).toEqual(view);
      await request(app.getHttpServer())
        .post(`/users/${U}/temporary-password`)
        .set('x-as', who)
        .expect(201);
    }
    expect(service.getTemporaryPassword).toHaveBeenCalledWith(U, callers.dono);
    expect(service.regenerateTemporaryPassword).toHaveBeenCalledWith(
      U,
      callers.analista,
    );
  });

  it('cliente recebe 403 e o serviço nem é chamado', async () => {
    await request(app.getHttpServer())
      .get(`/users/${U}/temporary-password`)
      .set('x-as', 'cliente')
      .expect(403);
    await request(app.getHttpServer())
      .post(`/users/${U}/temporary-password`)
      .set('x-as', 'cliente')
      .expect(403);
    expect(service.getTemporaryPassword).not.toHaveBeenCalled();
    expect(service.regenerateTemporaryPassword).not.toHaveBeenCalled();
  });

  it('id que não é UUID dá 400', async () => {
    await request(app.getHttpServer())
      .get('/users/nao-e-uuid/temporary-password')
      .set('x-as', 'dono')
      .expect(400);
    expect(service.getTemporaryPassword).not.toHaveBeenCalled();
  });
});
