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
import { AuditController } from '../src/audit/audit.controller';
import { AuditService } from '../src/audit/audit.service';

// GET /audit-logs through the real controller and the same ValidationPipe as
// main.ts (BE-07). Auth is covered by guards.e2e-spec.ts; here a stub guard
// just attaches the caller.
const caller = { tenantId: 't1', userId: 'u1', role: 'dono' };

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest<{ user: unknown }>().user = caller;
    return true;
  }
}

describe('GET /audit-logs query (e2e, BE-07)', () => {
  let app: INestApplication<App>;
  const findAll = jest.fn().mockResolvedValue([]);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        { provide: AuditService, useValue: { findAll, undo: jest.fn() } },
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

  beforeEach(() => findAll.mockClear());

  afterAll(async () => {
    await app.close();
  });

  it('keeps the plain paginated call working', async () => {
    await request(app.getHttpServer()).get('/audit-logs?limit=100').expect(200);
    expect(findAll).toHaveBeenCalledWith(caller, 100, 0, {
      processId: undefined,
      action: undefined,
      from: undefined,
      to: undefined,
    });
  });

  it('defaults to limit 50 / offset 0 without a query string', async () => {
    await request(app.getHttpServer()).get('/audit-logs').expect(200);
    expect(findAll).toHaveBeenCalledWith(caller, 50, 0, expect.any(Object));
  });

  it('forwards process, action and period filters to the service', async () => {
    await request(app.getHttpServer())
      .get('/audit-logs')
      .query({
        limit: '25',
        offset: '25',
        processId: '3f8b0c5e-2a1d-4f6b-9c7e-1a2b3c4d5e6f',
        action: 'stage_change',
        from: '2026-10-01',
        to: '2026-10-07',
      })
      .expect(200);
    expect(findAll).toHaveBeenCalledWith(caller, 25, 25, {
      processId: '3f8b0c5e-2a1d-4f6b-9c7e-1a2b3c4d5e6f',
      action: 'stage_change',
      from: '2026-10-01',
      to: '2026-10-07',
    });
  });

  it.each([
    ['processId=123'],
    ['from=07/10/2026'],
    ['to=2026-02-30'],
    ['action=DROP%20TABLE'],
    ['tenantId=t2'],
  ])('400s an invalid query (%s) before reaching the service', async (qs) => {
    await request(app.getHttpServer()).get(`/audit-logs?${qs}`).expect(400);
    expect(findAll).not.toHaveBeenCalled();
  });
});
