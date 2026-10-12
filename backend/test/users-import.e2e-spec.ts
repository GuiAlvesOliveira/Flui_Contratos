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
import { UsersController } from '../src/users/users.controller';
import { UsersService } from '../src/users/users.service';

// POST /users/import and /users/bulk through the real controller, multer and
// the same ValidationPipe as main.ts (BE-01). Auth is covered by
// guards.e2e-spec.ts; a stub guard attaches the caller.
const caller = { tenantId: 't1', userId: 'u1', role: 'dono' };

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest<{ user: unknown }>().user = caller;
    return true;
  }
}

describe('Users import routes (e2e, BE-01)', () => {
  let app: INestApplication<App>;
  const importCsv = jest.fn().mockResolvedValue({ total: 1, created: 1 });
  const createBulk = jest.fn().mockResolvedValue([]);
  const user = (email: string) => ({
    email,
    name: 'Ana',
    role: 'cliente',
    cpf: '52998224725',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: { importCsv, createBulk } },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
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

  beforeEach(() => {
    importCsv.mockClear();
    createBulk.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes the uploaded CSV bytes to the service', async () => {
    const content =
      'nome;email;cpf;perfil\r\nAna;ana@exemplo.dev;52998224725;cliente';
    await request(app.getHttpServer())
      .post('/users/import')
      .attach('file', Buffer.from(content), 'usuarios.csv')
      .expect(201);
    const [buf, who] = importCsv.mock.calls[0] as [Buffer, unknown];
    expect(buf.toString('utf-8')).toBe(content);
    expect(who).toEqual(caller);
  });

  it('400s without a file or with a file that is not .csv', async () => {
    await request(app.getHttpServer()).post('/users/import').expect(400);
    await request(app.getHttpServer())
      .post('/users/import')
      .attach('file', Buffer.from('%PDF-1.4'), 'usuarios.pdf')
      .expect(400);
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('413s a file over 1 MB', async () => {
    await request(app.getHttpServer())
      .post('/users/import')
      .attach('file', Buffer.alloc(1024 * 1024 + 1, 'a'), 'grande.csv')
      .expect(413);
    expect(importCsv).not.toHaveBeenCalled();
  });

  it('/users/bulk validates every item like POST /users', async () => {
    await request(app.getHttpServer())
      .post('/users/bulk')
      .send({ users: [user('ok@exemplo.dev'), { ...user('nao-e-email') }] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/users/bulk')
      .send({ users: [{ ...user('a@exemplo.dev'), role: 'admin' }] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/users/bulk')
      .send({ users: [{ ...user('a@exemplo.dev'), tenantId: 'x' }] })
      .expect(400);
    expect(createBulk).not.toHaveBeenCalled();
  });

  it('/users/bulk refuses an empty list or more than 100 users', async () => {
    await request(app.getHttpServer())
      .post('/users/bulk')
      .send({ users: [] })
      .expect(400);
    const many = Array.from({ length: 101 }, (_, i) =>
      user(`u${i}@exemplo.dev`),
    );
    await request(app.getHttpServer())
      .post('/users/bulk')
      .send({ users: many })
      .expect(400);
    expect(createBulk).not.toHaveBeenCalled();
  });

  it('/users/bulk with valid items reaches the service', async () => {
    await request(app.getHttpServer())
      .post('/users/bulk')
      .send({ users: [user('a@exemplo.dev'), user('b@exemplo.dev')] })
      .expect(201);
    expect(createBulk).toHaveBeenCalledWith(
      [
        expect.objectContaining({ email: 'a@exemplo.dev' }),
        expect.objectContaining({ email: 'b@exemplo.dev' }),
      ],
      caller,
    );
  });
});
