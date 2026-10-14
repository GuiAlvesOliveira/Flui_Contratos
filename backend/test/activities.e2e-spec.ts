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
import { ActivitiesController } from '../src/activities/activities.controller';
import { ActivitiesService } from '../src/activities/activities.service';
import { RolesGuard } from '../src/common/guards/roles.guard';

// Histórico de Atividades through the real controller, the real RolesGuard and
// the same ValidationPipe as main.ts. Authentication is covered by
// guards.e2e-spec.ts; here a stub guard attaches the caller named in a header.
const P = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const users: Record<string, object> = {
  analista: {
    tenantId: 't1',
    userId: 'an1',
    role: 'analista',
    name: 'Rafaela',
  },
  dono: { tenantId: 't1', userId: 'g1', role: 'dono', name: 'Gestora' },
  cliente: { tenantId: 't1', userId: 'c1', role: 'cliente', name: 'Helena' },
};

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user: unknown }>();
    req.user = users[req.headers['x-as']];
    return true;
  }
}

describe('Histórico de Atividades (e2e)', () => {
  let app: INestApplication<App>;
  const service = {
    list: jest.fn().mockResolvedValue({ canCreate: false, activities: [] }),
    create: jest.fn().mockResolvedValue({ id: 'new' }),
    update: jest.fn().mockResolvedValue({ id: A }),
    remove: jest.fn().mockResolvedValue({ id: A, deleted: true }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ActivitiesController],
      providers: [
        { provide: ActivitiesService, useValue: service },
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
  beforeEach(() => Object.values(service).forEach((fn) => fn.mockClear()));
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const url = `/processes/${P}/activities`;

  it('analista, gestor and cliente read the history', async () => {
    for (const as of ['analista', 'dono', 'cliente']) {
      await http().get(url).set('x-as', as).expect(200);
    }
    expect(service.list).toHaveBeenCalledTimes(3);
  });

  it('only the analista profile may register (gestor and cliente get 403)', async () => {
    await http()
      .post(url)
      .set('x-as', 'dono')
      .send({ description: 'Texto' })
      .expect(403);
    await http()
      .post(url)
      .set('x-as', 'cliente')
      .send({ description: 'Texto' })
      .expect(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('the description is trimmed and is the only field accepted', async () => {
    await http()
      .post(url)
      .set('x-as', 'analista')
      .send({ description: '  Liguei para o cliente  ' })
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(
      P,
      'Liguei para o cliente',
      users.analista,
    );
  });

  it.each([
    ['without description', {}],
    ['blank', { description: '    ' }],
    ['too short', { description: 'ok' }],
    ['too long', { description: 'x'.repeat(2001) }],
    ['not a text', { description: 42 }],
    ['forging the stage', { description: 'Texto válido', stage: 'cartorio' }],
    [
      'forging the date',
      { description: 'Texto válido', createdAt: '2020-01-01T00:00:00Z' },
    ],
    ['forging the author', { description: 'Texto válido', authorId: 'g1' }],
  ])('rejects a body %s (400)', async (_case, body) => {
    await http().post(url).set('x-as', 'analista').send(body).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('accepts exactly 2000 characters', async () => {
    await http()
      .post(url)
      .set('x-as', 'analista')
      .send({ description: 'x'.repeat(2000) })
      .expect(201);
  });

  it('only the analista profile edits (the service checks the author)', async () => {
    await http()
      .patch(`${url}/${A}`)
      .set('x-as', 'dono')
      .send({ description: 'Novo texto' })
      .expect(403);
    await http()
      .patch(`${url}/${A}`)
      .set('x-as', 'cliente')
      .send({ description: 'Novo texto' })
      .expect(403);
    await http()
      .patch(`${url}/${A}`)
      .set('x-as', 'analista')
      .send({ description: 'Novo texto' })
      .expect(200);
    expect(service.update).toHaveBeenCalledWith(
      P,
      A,
      'Novo texto',
      users.analista,
    );
  });

  it('the client never removes; the gestor sends the reason in the query', async () => {
    await http().delete(`${url}/${A}`).set('x-as', 'cliente').expect(403);
    await http()
      .delete(`${url}/${A}?reason=%20Texto%20errado%20`)
      .set('x-as', 'dono')
      .expect(200);
    expect(service.remove).toHaveBeenCalledTimes(1);
    expect(service.remove).toHaveBeenCalledWith(
      P,
      A,
      'Texto errado',
      users.dono,
    );
  });

  it('ids must be UUIDs', async () => {
    await http()
      .get('/processes/abc/activities')
      .set('x-as', 'analista')
      .expect(400);
    await http().delete(`${url}/abc`).set('x-as', 'analista').expect(400);
  });
});
