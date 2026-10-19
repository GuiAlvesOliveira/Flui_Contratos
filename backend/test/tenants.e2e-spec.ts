import { Test } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Readable } from 'stream';
import request from 'supertest';
import { App } from 'supertest/types';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TenantsController } from '../src/tenants/tenants.controller';
import { TenantsService } from '../src/tenants/tenants.service';

// PROD-04 through the real controller, RolesGuard, multer limit and the same
// ValidationPipe as main.ts. Authentication is covered by guards.e2e-spec.ts;
// here a stub guard attaches the caller named in the x-as header.
const users: Record<string, object> = {
  dono: { tenantId: 't1', userId: 'g1', role: 'dono' },
  analista: { tenantId: 't1', userId: 'a1', role: 'analista' },
  cliente: { tenantId: 't1', userId: 'c1', role: 'cliente' },
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

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('Assessoria — /tenants/me (e2e, PROD-04)', () => {
  let app: INestApplication<App>;
  const view = { id: 't1', name: 'Alfa', slug: 'alfa', logo: null };
  const service = {
    create: jest.fn(),
    getMine: jest.fn().mockResolvedValue(view),
    updateMine: jest.fn().mockResolvedValue(view),
    uploadLogo: jest.fn().mockResolvedValue(view),
    removeLogo: jest.fn().mockResolvedValue(view),
    getLogo: jest.fn(() =>
      Promise.resolve({
        stream: Readable.from([PNG]),
        contentType: 'image/png',
        contentLength: PNG.length,
      }),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantsController],
      providers: [
        { provide: TenantsService, useValue: service },
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

  it('gestor, analista and cliente read their own assessoria', async () => {
    for (const as of ['dono', 'analista', 'cliente']) {
      await http().get('/tenants/me').set('x-as', as).expect(200, view);
    }
    expect(service.getMine).toHaveBeenCalledTimes(3);
  });

  it('only the gestor renames it: analista and cliente get 403', async () => {
    for (const as of ['analista', 'cliente']) {
      await http()
        .patch('/tenants/me')
        .set('x-as', as)
        .send({ name: 'Outro nome' })
        .expect(403);
    }
    expect(service.updateMine).not.toHaveBeenCalled();
    await http()
      .patch('/tenants/me')
      .set('x-as', 'dono')
      .send({ name: '  Assessoria   Beta ' })
      .expect(200);
    expect(service.updateMine).toHaveBeenCalledWith(
      { name: 'Assessoria Beta' },
      users.dono,
    );
  });

  it.each([
    ['without name', {}],
    ['a blank name', { name: '   ' }],
    ['a name too long', { name: 'x'.repeat(101) }],
    ['another field (slug)', { name: 'Alfa', slug: 'outra' }],
    ['another field (plan)', { name: 'Alfa', plano: 'escala' }],
  ])('rejects a body with %s (400)', async (_c, body) => {
    await http()
      .patch('/tenants/me')
      .set('x-as', 'dono')
      .send(body)
      .expect(400);
    expect(service.updateMine).not.toHaveBeenCalled();
  });

  it('only the gestor uploads or removes the logo', async () => {
    for (const as of ['analista', 'cliente']) {
      await http()
        .put('/tenants/me/logo')
        .set('x-as', as)
        .attach('file', PNG, 'logo.png')
        .expect(403);
      await http().delete('/tenants/me/logo').set('x-as', as).expect(403);
    }
    expect(service.uploadLogo).not.toHaveBeenCalled();
    expect(service.removeLogo).not.toHaveBeenCalled();
    await http()
      .put('/tenants/me/logo')
      .set('x-as', 'dono')
      .attach('file', PNG, 'logo.png')
      .expect(200);
    expect(service.uploadLogo).toHaveBeenCalledTimes(1);
  });

  it('a file over 1 MB is refused before reaching the service (413)', async () => {
    await http()
      .put('/tenants/me/logo')
      .set('x-as', 'dono')
      .attach('file', Buffer.alloc(1024 * 1024 + 1, 1), 'logo.png')
      .expect(413);
    expect(service.uploadLogo).not.toHaveBeenCalled();
  });

  it('everyone of the assessoria gets the logo, served as an image with nosniff', async () => {
    const res = await http()
      .get('/tenants/me/logo')
      .set('x-as', 'cliente')
      .expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
  });
});
