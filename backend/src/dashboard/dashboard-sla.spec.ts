import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import {
  buildByAnalista,
  buildSla,
  SLA_DAYS,
  type AnalistaRef,
  type SlaRow,
} from './dashboard-sla';
import { DashboardService } from './dashboard.service';

const NOW = new Date('2026-10-14T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const proc = (
  id: string,
  stage: SlaRow['stage'],
  days: number,
  analista_id: string | null = 'a1',
  client_name: string | null = `Cliente ${id}`,
): SlaRow => ({
  id,
  stage,
  analista_id,
  client_name,
  client_email: `${id}@exemplo.dev`,
  stage_since: daysAgo(days),
});

describe('PROD-10: prazo de atendimento (SLA)', () => {
  it('fora do prazo = mais de 7 dias na etapa atual', () => {
    expect(SLA_DAYS).toBe(7);
    const s = buildSla(
      [
        proc('p1', 'cadastro', 7),
        proc('p2', 'analise_credito', 7.5),
        proc('p3', 'analise_juridica', 1),
      ],
      NOW,
    );
    expect(s).toMatchObject({ days: 7, tracked: 3, overdue: 1 });
    expect(s.oldest).toEqual([
      {
        processId: 'p2',
        clientName: 'Cliente p2',
        stage: 'analise_credito',
        daysInStage: 7,
      },
    ]);
  });

  it('assinatura, inativo e crédito recusado não contam', () => {
    const s = buildSla(
      [
        proc('p1', 'assinatura', 40),
        proc('p2', 'cliente_inativo', 40),
        proc('p3', 'credito_recusado', 40),
        proc('p4', 'processo_pendencia', 10),
      ],
      NOW,
    );
    expect(s).toMatchObject({ tracked: 1, overdue: 1 });
    expect(s.oldest.map((o) => o.processId)).toEqual(['p4']);
  });

  it('lista os 5 mais antigos, do mais parado para o menos; sem nome usa o e-mail', () => {
    const rows = [8, 30, 12, 9, 25, 15, 3].map((d, i) =>
      proc(`p${i}`, 'cadastro', d, 'a1', i === 1 ? null : `Cliente p${i}`),
    );
    const s = buildSla(rows, NOW);
    expect(s.overdue).toBe(6);
    expect(s.oldest.map((o) => o.daysInStage)).toEqual([30, 25, 15, 12, 9]);
    expect(s.oldest[0].clientName).toBe('p1@exemplo.dev');
  });
});

describe('PROD-10: visão por analista (gestor)', () => {
  const analistas: AnalistaRef[] = [
    {
      id: 'a2',
      name: 'Bruno',
      surname: 'Lima',
      email: 'b@x',
      status: 'active',
    },
    { id: 'a1', name: 'Ana', surname: null, email: 'a@x', status: 'active' },
    {
      id: 'a3',
      name: 'Carla',
      surname: null,
      email: 'c@x',
      status: 'disabled',
    },
    { id: 'a4', name: 'Davi', surname: null, email: 'd@x', status: 'disabled' },
  ];

  it('processos ativos, docs para validar, tempos de análise e fora do prazo por analista', () => {
    const rows = buildByAnalista(
      analistas,
      [
        proc('p1', 'analise_credito', 10, 'a1'),
        proc('p2', 'cadastro', 2, 'a1'),
        proc('p3', 'assinatura', 30, 'a2'),
        proc('p4', 'analise_juridica', 9, 'a3'),
        proc('p5', 'cadastro', 20, null),
      ],
      [
        { analista_id: 'a1', to_validate: '3' },
        { analista_id: null, to_validate: '1' },
      ],
      [
        { analista_id: 'a1', from_state: 'analise_credito', days_in_from: '4' },
        { analista_id: 'a1', from_state: 'analise_credito', days_in_from: 6 },
        {
          analista_id: 'a1',
          from_state: 'analise_juridica',
          days_in_from: 2.25,
        },
        {
          analista_id: 'a2',
          from_state: 'analise_credito',
          days_in_from: null,
        },
      ],
      NOW,
    );
    expect(rows).toEqual([
      {
        analistaId: 'a1',
        name: 'Ana',
        activeProcesses: 2,
        docsToValidate: 3,
        avgDaysCredito: 5,
        avgDaysJuridico: 2.3,
        overdue: 1,
      },
      {
        analistaId: 'a2',
        name: 'Bruno Lima',
        activeProcesses: 1,
        docsToValidate: 0,
        avgDaysCredito: null,
        avgDaysJuridico: null,
        overdue: 0,
      },
      // desativada, mas ainda com processo ativo
      {
        analistaId: 'a3',
        name: 'Carla',
        activeProcesses: 1,
        docsToValidate: 0,
        avgDaysCredito: null,
        avgDaysJuridico: null,
        overdue: 1,
      },
      {
        analistaId: null,
        name: 'Sem analista',
        activeProcesses: 1,
        docsToValidate: 1,
        avgDaysCredito: null,
        avgDaysJuridico: null,
        overdue: 1,
      },
    ]);
  });
});

describe('PROD-10: consultas do DashboardService', () => {
  const dono = {
    tenantId: 't1',
    userId: 'g1',
    role: 'dono',
  } as RequestUserFull;
  const analista = {
    tenantId: 't1',
    userId: 'a1',
    role: 'analista',
  } as RequestUserFull;
  const make = () => {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    return {
      service: new DashboardService(dataSource as unknown as DataSource),
      dataSource,
    };
  };

  it('o resumo traz o SLA, só dos processos do analista quando é ele que pede', async () => {
    const { service, dataSource } = make();
    dataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([proc('p1', 'cadastro', 9)]);
    const res = await service.summary(analista, '30');
    expect(res.sla).toMatchObject({ days: 7, tracked: 1, overdue: 1 });
    const [sql, params] = dataSource.query.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain(
      'p.tenant_id = $1 AND p.active = true AND p.analista_id = $2',
    );
    expect(params).toEqual(['t1', 'a1']);

    dataSource.query.mockClear();
    await service.summary(dono, '30');
    const [, donoParams] = dataSource.query.mock.calls[2] as [
      string,
      unknown[],
    ];
    expect(donoParams).toEqual(['t1']);
  });

  it('RN-01: todas as consultas da visão por analista ficam na assessoria de quem pede', async () => {
    const { service, dataSource } = make();
    const res = await service.byAnalista(dono, '90');
    expect(res).toEqual({ days: 90, slaDays: 7, analistas: [] });
    const calls = dataSource.query.mock.calls as [string, unknown[]][];
    expect(calls).toHaveLength(4);
    for (const [sql, params] of calls) {
      expect(params[0]).toBe('t1');
      expect(sql).toMatch(/tenant_id = \$1/);
    }
    expect(calls[0][0]).toContain("role = 'analista'");
    expect(calls[3][1]).toEqual(['t1', 90]);
  });
});
