import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuditService } from '../src/audit/audit.service';
import type { RequestUserFull } from '../src/auth/supabase.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { MessagingService } from '../src/messaging/messaging.service';
import { Process } from '../src/processes/process.entity';
import { ProcessesService } from '../src/processes/processes.service';
import { ReportsController } from '../src/reports/reports.controller';
import { ReportsService } from '../src/reports/reports.service';
import { successFee } from '../src/reports/success-fee';
import { User } from '../src/users/user.entity';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
} from './support/test-db';

const who = (tenantId: string, userId: string, role: string) =>
  ({ tenantId, userId, role }) as RequestUserFull;
const gestorA = who(IDS.tenantA, IDS.gestorA, 'dono');
const ana = who(IDS.tenantA, IDS.anaA, 'analista');
const gestorB = who(IDS.tenantB, IDS.gestorB, 'dono');

describe('Success fee — papéis (e2e, PROD-09)', () => {
  let app: INestApplication<App>;
  const users: Record<string, object> = {
    ana,
    clienteA: who(IDS.tenantA, IDS.clienteA, 'cliente'),
    gestorA,
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
  const service = {
    successFee: jest.fn().mockResolvedValue({}),
    successFeeExport: jest
      .fn()
      .mockResolvedValue({ csv: 'x', fileName: 'success-fee-2026.csv' }),
  };
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        { provide: ReportsService, useValue: service },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();
    app = m.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });
  afterAll(() => app.close());

  it('analista e cliente recebem 403; o gestor recebe o CSV', async () => {
    for (const as of ['ana', 'clienteA']) {
      await request(app.getHttpServer())
        .get('/reports/success-fee')
        .set('x-as', as)
        .expect(403);
      await request(app.getHttpServer())
        .get('/reports/success-fee/export')
        .set('x-as', as)
        .expect(403);
    }
    const res = await request(app.getHttpServer())
      .get('/reports/success-fee/export?year=2026')
      .set('x-as', 'gestorA')
      .expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="success-fee-2026.csv"',
    );
    expect(service.successFeeExport).toHaveBeenCalledWith(gestorA, '2026');
    await request(app.getHttpServer())
      .get('/reports/success-fee?year=26')
      .set('x-as', 'gestorA')
      .expect(400);
  });
});

describeDb('Success fee com banco real (e2e, PROD-09)', () => {
  let db: TestDb;
  let processes: ProcessesService;
  let audit: AuditService;
  let reports: ReportsService;
  const config = {
    get: (k: string) =>
      k === 'FRONTEND_URL' ? 'https://app.exemplo.dev' : undefined,
  } as unknown as ConfigService;
  const year = String(new Date(Date.now() - 3 * 3600_000).getUTCFullYear());

  const ds = () => db.dataSource;
  const row = async (id: string) =>
    (
      await ds().query<
        {
          stage: string;
          contrato_assinado_em: Date | null;
          comissao_assessoria: string | null;
          taxa_success_fee: string | null;
        }[]
      >(
        `SELECT stage, contrato_assinado_em, comissao_assessoria, taxa_success_fee FROM processes WHERE id = $1`,
        [id],
      )
    )[0];
  // processo em Cartório, com MIP/DFI e documento validado: pode ir para Assinatura (RN-04/RN-05)
  const readyToSign = async (
    tenant: string,
    client: string,
    analista: string,
    opts: { financing?: number; aberto?: number } = {},
  ) => {
    const id = randomUUID();
    await ds().query(
      `INSERT INTO processes (id, tenant_id, client_id, analista_id, stage, mip_value, dfi_value, valor_em_aberto)
       VALUES ($1, $2, $3, $4, 'cartorio', 45.9, 22.1, $5)`,
      [id, tenant, client, analista, opts.aberto ?? null],
    );
    await ds().query(
      `INSERT INTO documents (tenant_id, process_id, user_id, name, label, status, validated)
       VALUES ($1, $2, $3, 'Matrícula', 'Matrícula', 'validado', true)`,
      [tenant, id, client],
    );
    if (opts.financing) {
      await ds().query(
        `INSERT INTO documents (tenant_id, process_id, user_id, name, label, status, validated, form_type, form_data)
         VALUES ($1, $2, $3, 'Financiamento', 'Financiamento', 'validado', true, 'financiamento', $4::jsonb)`,
        [
          tenant,
          id,
          client,
          JSON.stringify({
            banco: 'Caixa',
            sistema: 'SAC',
            prazoMeses: 360,
            valorFinanciado: opts.financing,
            valorEntrada: 70000,
            usaFgts: false,
            rendaComprovada: 12000,
          }),
        ],
      );
    }
    return id;
  };
  const makeProcesses = (messaging: MessagingService) =>
    new ProcessesService(
      ds().getRepository(Process),
      ds().getRepository(User),
      ds(),
      messaging,
    );

  let p1: string;
  let p3: string;
  let p4: string;

  beforeAll(async () => {
    db = await createTestDb('successfee');
    await seedTwoTenants(ds());
    await ds().query(
      `UPDATE tenants SET plano = 'profissional' WHERE id = $1`,
      [IDS.tenantA],
    );
    await ds().query(`UPDATE tenants SET plano = 'escala' WHERE id = $1`, [
      IDS.tenantB,
    ]);
    const messaging = new MessagingService(config, {
      soon: jest.fn(),
    } as never);
    processes = makeProcesses(messaging);
    audit = new AuditService(ds(), messaging);
    reports = new ReportsService(ds(), new DashboardService(ds()));
  }, 60_000);
  afterAll(async () => {
    await db?.drop();
  });

  it('entrar em Assinatura grava a data na mesma transação, com a taxa do plano e a sugestão de 2% do financiamento', async () => {
    p1 = await readyToSign(IDS.tenantA, IDS.clienteA, IDS.anaA, {
      financing: 350000,
      aberto: 300000,
    });
    expect((await row(p1)).contrato_assinado_em).toBeNull();
    await processes.advanceStage(p1, { toStage: 'assinatura' }, ana);
    const r = await row(p1);
    expect(r.stage).toBe('assinatura');
    expect(
      Date.now() - new Date(r.contrato_assinado_em!).getTime(),
    ).toBeLessThan(60_000);
    expect(r.taxa_success_fee).toBe('0.0100'); // plano Profissional
    expect(r.comissao_assessoria).toBe('7000.00'); // 2% de R$ 350 mil (formulário de financiamento)
  });

  it('se a mudança de etapa falha, nem a etapa nem a data de assinatura ficam', async () => {
    const id = await readyToSign(IDS.tenantA, IDS.clienteA, IDS.anaA, {
      financing: 200000,
    });
    const broken = makeProcesses({
      stageChanged: jest.fn().mockRejectedValue(new Error('fila fora')),
    } as unknown as MessagingService);
    await expect(
      broken.advanceStage(id, { toStage: 'assinatura' }, ana),
    ).rejects.toThrow('fila fora');
    expect(await row(id)).toMatchObject({
      stage: 'cartorio',
      contrato_assinado_em: null,
      comissao_assessoria: null,
      taxa_success_fee: null,
    });
    await ds().query(`UPDATE processes SET active = false WHERE id = $1`, [id]);
  });

  it('comissão informada pelo analista vale (não é trocada pela sugestão) e a edição vai para o Log de Ações', async () => {
    p3 = await readyToSign(IDS.tenantA, IDS.clienteA, IDS.anaA, {
      financing: 500000,
    });
    await processes.updateFields(p3, { comissaoAssessoria: 5000 }, ana);
    const [log] = await ds().query<
      { metadata: { before: number | null; after: number } }[]
    >(
      `SELECT metadata FROM audit_logs WHERE process_id = $1 AND action = 'commission_updated'`,
      [p3],
    );
    expect(log.metadata).toEqual({ before: null, after: 5000 });
    await processes.advanceStage(p3, { toStage: 'assinatura' }, ana);
    expect((await row(p3)).comissao_assessoria).toBe('5000.00');
  });

  it('se o registro no Log de Ações falha, a comissão não muda (mesma transação)', async () => {
    const id = await readyToSign(IDS.tenantA, IDS.clienteA, IDS.anaA);
    await processes.updateFields(id, { comissaoAssessoria: 1000 }, ana);
    await ds().query(
      `ALTER TABLE audit_logs ADD CONSTRAINT e2e_no_commission CHECK (action <> 'commission_updated') NOT VALID`,
    );
    try {
      await expect(
        processes.updateFields(id, { comissaoAssessoria: 2000 }, ana),
      ).rejects.toThrow(/e2e_no_commission/);
    } finally {
      await ds().query(
        `ALTER TABLE audit_logs DROP CONSTRAINT e2e_no_commission`,
      );
    }
    expect((await row(id)).comissao_assessoria).toBe('1000.00');
    await ds().query(`UPDATE processes SET active = false WHERE id = $1`, [id]);
  });

  it('sem formulário de financiamento, a sugestão usa o valor em aberto', async () => {
    p4 = await readyToSign(IDS.tenantA, IDS.clienteA, IDS.brunoA, {
      aberto: 280000,
    });
    await processes.advanceStage(p4, { toStage: 'assinatura' }, gestorA);
    expect((await row(p4)).comissao_assessoria).toBe('5600.00');
  });

  it('desfazer a entrada em Assinatura (Log de Ações) desfaz a assinatura e mantém a comissão', async () => {
    const [log] = await ds().query<{ id: string }[]>(
      `SELECT id FROM audit_logs WHERE process_id = $1 AND action = 'stage_change' AND to_state = 'assinatura'`,
      [p4],
    );
    await audit.undo(log.id, gestorA);
    expect(await row(p4)).toMatchObject({
      stage: 'cartorio',
      contrato_assinado_em: null,
      taxa_success_fee: null,
      comissao_assessoria: '5600.00',
    });
  });

  it('relatório do gestor: contratos do mês, comissão total e success fee (comissão × taxa, em centavos)', async () => {
    const r = await reports.successFee(gestorA, year);
    expect(r.plan).toEqual({
      code: 'profissional',
      label: 'Profissional',
      rate: 0.01,
    });
    expect(
      r.contracts.map((c) => [c.processId, c.commission, c.rate, c.fee]),
    ).toEqual([
      [p1, 7000, 0.01, 70],
      [p3, 5000, 0.01, 50],
    ]);
    const month = r.months.find((m) => m.contracts > 0)!;
    expect(month).toMatchObject({
      contracts: 2,
      commission: 12000,
      fee: 120,
      pending: 0,
    });
    expect(r.totals).toEqual({
      contracts: 2,
      commission: 12000,
      fee: 120,
      pending: 0,
    });
    // o cálculo em inteiros confere com o ROUND do PostgreSQL
    for (const [c, t] of [
      [7333.33, 0.015],
      [1234.5, 0.005],
      [1235, 0.005],
      [3.33, 0.015],
    ]) {
      const [{ fee }] = await ds().query<{ fee: string }[]>(
        `SELECT ROUND($1::numeric * $2::numeric, 2) AS fee`,
        [c, t],
      );
      expect(successFee(c, t)).toBe(Number(fee));
    }
  });

  it('trocar o plano depois não muda os contratos já assinados', async () => {
    await ds().query(`UPDATE tenants SET plano = 'escala' WHERE id = $1`, [
      IDS.tenantA,
    ]);
    const r = await reports.successFee(gestorA, year);
    expect(r.plan.code).toBe('escala');
    expect(r.totals.fee).toBe(120);
  });

  it('isolamento: cada assessoria só vê os próprios contratos', async () => {
    const pb = await readyToSign(IDS.tenantB, IDS.clienteB, IDS.analistaB, {
      financing: 100000,
    });
    await processes.advanceStage(pb, { toStage: 'assinatura' }, gestorB);
    const b = await reports.successFee(gestorB, year);
    expect(
      b.contracts.map((c) => [c.processId, c.commission, c.rate, c.fee]),
    ).toEqual([[pb, 2000, 0.005, 10]]);
    const a = await reports.successFee(gestorA, year);
    expect(a.contracts.map((c) => c.processId)).not.toContain(pb);
  });

  it('CSV com os mesmos números e a exportação no Log de Ações', async () => {
    const { csv, fileName } = await reports.successFeeExport(gestorA, year);
    expect(fileName).toBe(`success-fee-${year}.csv`);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(
      /;Carla Cliente;Ana;350000,00;7000,00;1,0%;70,00$/,
    );
    expect(lines[2]).toMatch(
      /;Carla Cliente;Ana;500000,00;5000,00;1,0%;50,00$/,
    );
    expect(lines[3]).toBe('Total;2 contrato(s);;;;12000,00;;120,00');
    const [{ n }] = await ds().query<{ n: string }[]>(
      `SELECT count(*) AS n FROM audit_logs WHERE tenant_id = $1 AND action = 'success_fee_exported'`,
      [IDS.tenantA],
    );
    expect(Number(n)).toBe(1);
  });

  it('o cliente vê a data do contrato, mas não a comissão, a taxa nem a edição da comissão', async () => {
    const cliente = who(IDS.tenantA, IDS.clienteA, 'cliente');
    const mine = (await processes.findOne(p3, cliente)) as Record<
      string,
      unknown
    >;
    expect(mine.contratoAssinadoEm).toBeInstanceOf(Date);
    expect(mine).not.toHaveProperty('comissaoAssessoria');
    expect(mine).not.toHaveProperty('taxaSuccessFee');
    const list = (await processes.findAll(cliente)) as Record<
      string,
      unknown
    >[];
    expect(list.map((p) => p.id)).toContain(p3);
    for (const p of list) {
      expect(p).not.toHaveProperty('comissaoAssessoria');
      expect(p).not.toHaveProperty('taxaSuccessFee');
    }
    const actions = async (who: RequestUserFull) =>
      ((await processes.getAuditLog(p3, who)) as { action: string }[]).map(
        (l) => l.action,
      );
    expect(await actions(cliente)).toContain('stage_change');
    expect(await actions(cliente)).not.toContain('commission_updated');
    // a equipe continua vendo tudo
    expect(await processes.findOne(p3, ana)).toMatchObject({
      comissaoAssessoria: '5000.00',
      taxaSuccessFee: '0.0100',
    });
    expect(await actions(ana)).toContain('commission_updated');
  });
});
