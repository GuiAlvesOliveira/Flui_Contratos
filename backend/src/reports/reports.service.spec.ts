import type { DataSource } from 'typeorm';
import type { RequestUserFull } from '../auth/supabase.guard';
import type { DashboardService } from '../dashboard/dashboard.service';
import { ReportsService } from './reports.service';

const gestor = {
  tenantId: 't1',
  userId: 'g1',
  role: 'dono',
} as RequestUserFull;

const ANALISTAS = [
  {
    id: 'a1',
    name: 'Bruno',
    surname: 'Lima',
    email: 'b@x',
    status: 'active',
    active: '2',
  },
  {
    id: 'a2',
    name: 'Ana',
    surname: null,
    email: 'a@x',
    status: 'active',
    active: '3',
  },
  {
    id: 'a3',
    name: null,
    surname: null,
    email: 'carla@x',
    status: 'active',
    active: '0',
  },
  {
    id: 'a4',
    name: 'Davi',
    surname: null,
    email: 'd@x',
    status: 'disabled',
    active: '0',
  },
];
const ACTIVITY = [
  { analista_id: 'a1', signed: '2', avg_days: '4.26' },
  { analista_id: 'a2', signed: '1', avg_days: '3' },
  { analista_id: null, signed: '1', avg_days: null },
];

function setup(unassigned = '1') {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/FROM users u/.test(sql)) return Promise.resolve(ANALISTAS);
    if (/WITH ch AS/.test(sql)) return Promise.resolve(ACTIVITY);
    if (/analista_id IS NULL/.test(sql))
      return Promise.resolve([{ n: unassigned }]);
    if (/FROM tenants/.test(sql))
      return Promise.resolve([{ name: 'Assessoria Alfa' }]);
    return Promise.resolve([]);
  });
  const summary = jest.fn().mockResolvedValue({
    days: 30,
    generatedAt: '2026-10-19T23:30:00.000Z',
    totals: {
      processes: 6,
      unitValue: 1850000,
      averageTicket: 370000,
      withValue: 5,
    },
    byStage: [],
    funnel: [
      { stage: 'inicial', reached: 6, pctOfTotal: 100, stepRate: null },
      { stage: 'assinatura', reached: 1, pctOfTotal: 16.7, stepRate: 50 },
    ],
    period: { newProcesses: 2, stageChanges: 9, signed: 4, entered: [] },
    avgDaysInStage: [
      { stage: 'cadastro', avgDays: 2.5, samples: 4 },
      { stage: 'processo_pendencia', avgDays: null, samples: 0 },
      { stage: 'credito_recusado', avgDays: 1, samples: 1 },
    ],
    sla: { days: 7, tracked: 0, overdue: 0, oldest: [] },
  });
  const service = new ReportsService(
    { query } as unknown as DataSource,
    { summary } as unknown as DashboardService,
  );
  return { service, calls, summary };
}

describe('ReportsService.ranking (PROD-03)', () => {
  it('tudo filtrado pela assessoria de quem chama, com o período em dias', async () => {
    const { service, calls } = setup();
    const r = await service.ranking(gestor, '90');
    expect(r.days).toBe(90);
    for (const c of calls) expect(c.params[0]).toBe('t1');
    const period = calls.find((c) => /WITH ch AS/.test(c.sql))!;
    expect(period.params).toEqual(['t1', 90]);
    expect(period.sql).toContain(
      "al.action IN ('stage_change', 'stage_change_undo')",
    );
    expect(period.sql).toContain(
      "COUNT(*) FILTER (WHERE ch.to_state = 'assinatura')",
    );
    expect(period.sql).toContain('p.active = true');
  });

  it('ordena por contratos assinados, depois processos ativos e nome; inclui "Sem analista"', async () => {
    const { service } = setup();
    const { analistas } = await service.ranking(gestor, '30');
    expect(analistas).toEqual([
      {
        analistaId: 'a1',
        name: 'Bruno Lima',
        signed: 2,
        activeProcesses: 2,
        avgDays: 4.3,
      },
      {
        analistaId: 'a2',
        name: 'Ana',
        signed: 1,
        activeProcesses: 3,
        avgDays: 3,
      },
      {
        analistaId: null,
        name: 'Sem analista',
        signed: 1,
        activeProcesses: 1,
        avgDays: null,
      },
      {
        analistaId: 'a3',
        name: 'carla@x',
        signed: 0,
        activeProcesses: 0,
        avgDays: null,
      },
    ]);
    // Davi está desativado e não tem processo nem atividade no período: fica de fora
  });

  it('período inválido cai no padrão de 30 dias; acima de 365 fica em 365', async () => {
    expect((await setup().service.ranking(gestor, 'abc')).days).toBe(30);
    expect((await setup().service.ranking(gestor, '9999')).days).toBe(365);
  });
});

describe('ReportsService.model e export (PROD-03)', () => {
  it('o modelo do arquivo vem do mesmo resumo da tela (GET /dashboard/summary) + ranking', async () => {
    const { service, summary } = setup('0');
    const m = await service.model(gestor, '30');
    expect(summary).toHaveBeenCalledWith(gestor, '30');
    expect(m).toMatchObject({
      tenantName: 'Assessoria Alfa',
      days: 30,
      from: '2026-09-19',
      to: '2026-10-19',
      kpis: {
        processes: 6,
        unitValue: 1850000,
        averageTicket: 370000,
        withValue: 5,
        newProcesses: 2,
        stageChanges: 9,
        signed: 4,
      },
      funnel: [
        {
          label: 'Primeiro Contato',
          reached: 6,
          pctOfTotal: 100,
          stepRate: null,
        },
        { label: 'Assinatura', reached: 1, pctOfTotal: 16.7, stepRate: 50 },
      ],
      // como na tela: Pendência sem saída no período fica de fora; Crédito Recusado com saída entra
      stageTime: [
        { label: 'Cadastro', avgDays: 2.5, samples: 4 },
        { label: 'Crédito Recusado', avgDays: 1, samples: 1 },
      ],
    });
    expect(m.ranking.map((r) => r.name)).toEqual([
      'Bruno Lima',
      'Ana',
      'Sem analista',
      'carla@x',
    ]);
  });

  it.each([
    [
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'PK',
    ],
    ['pdf', 'application/pdf', '%PDF'],
  ] as const)(
    'exporta %s, registra no Log de Ações e nomeia o arquivo',
    async (format, type, magic) => {
      const { service, calls } = setup();
      const r = await service.export(gestor, format, '30');
      expect(r.contentType).toBe(type);
      expect(r.fileName).toBe(`relatorio-2026-10-19-30dias.${format}`);
      expect(r.file.subarray(0, magic.length).toString('latin1')).toBe(magic);
      const audit = calls.find((c) => /report_exported/.test(c.sql))!;
      expect(audit.params).toEqual([
        't1',
        'g1',
        JSON.stringify({ format, days: 30 }),
      ]);
    },
  );
});
