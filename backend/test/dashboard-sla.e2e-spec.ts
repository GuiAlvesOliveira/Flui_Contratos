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
import { DashboardController } from '../src/dashboard/dashboard.controller';
import { DashboardService } from '../src/dashboard/dashboard.service';

// PROD-10: GET /dashboard/analistas only for the gestor; GET /dashboard/summary
// for gestor and analista. Real controller, RolesGuard and ValidationPipe.
const callers: Record<string, object> = {
  dono: { tenantId: 't1', userId: 'g1', role: 'dono' },
  analista: { tenantId: 't1', userId: 'a1', role: 'analista' },
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

describe('Dashboard — SLA (e2e, PROD-10)', () => {
  let app: INestApplication<App>;
  const service = {
    summary: jest.fn().mockResolvedValue({ sla: { days: 7 } }),
    byAnalista: jest
      .fn()
      .mockResolvedValue({ days: 30, slaDays: 7, analistas: [] }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: service },
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

  it('gestor vê a visão por analista, com o período pedido', async () => {
    await request(app.getHttpServer())
      .get('/dashboard/analistas?days=90')
      .set('x-as', 'dono')
      .expect(200);
    expect(service.byAnalista).toHaveBeenCalledWith(callers.dono, '90');
  });

  it('analista e cliente recebem 403 na visão por analista', async () => {
    for (const who of ['analista', 'cliente']) {
      await request(app.getHttpServer())
        .get('/dashboard/analistas')
        .set('x-as', who)
        .expect(403);
    }
    expect(service.byAnalista).not.toHaveBeenCalled();
  });

  it('o analista continua tendo o resumo (com o SLA dele); período inválido dá 400', async () => {
    await request(app.getHttpServer())
      .get('/dashboard/summary?days=7')
      .set('x-as', 'analista')
      .expect(200);
    expect(service.summary).toHaveBeenCalledWith(callers.analista, '7');
    await request(app.getHttpServer())
      .get('/dashboard/analistas?days=abc')
      .set('x-as', 'dono')
      .expect(400);
  });
});
