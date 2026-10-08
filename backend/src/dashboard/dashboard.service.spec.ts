import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { buildSummary, clampDays, type SnapshotRow } from './dashboard-summary';
import { DashboardService, SUMMARY_TTL_MS } from './dashboard.service';

const NOW = new Date('2026-10-08T12:00:00Z');
const snap = (
  stage: SnapshotRow['stage'],
  valor: number | null = null,
  created_at = '2026-01-01T00:00:00Z',
  stage_before_pendencia: SnapshotRow['stage_before_pendencia'] = null,
): SnapshotRow => ({ stage, valor, created_at, stage_before_pendencia });

describe('BE-14: dashboard summary', () => {
  it('keeps ?days between 1 and 365, default 30', () => {
    expect(clampDays(undefined)).toBe(30);
    expect(clampDays('0')).toBe(30);
    expect(clampDays('abc')).toBe(30);
    expect(clampDays('7')).toBe(7);
    expect(clampDays('9999')).toBe(365);
  });

  it('counts by stage, sums unit values and builds the funnel', () => {
    const s = buildSummary(
      30,
      [
        snap('cadastro', 300000),
        snap('analise_credito', 500000),
        snap('assinatura', '400000.00' as unknown as number),
        snap('credito_recusado'),
        snap('processo_pendencia', null, undefined, 'analise_juridica'),
      ],
      [],
      NOW,
    );
    expect(s.totals).toEqual({
      processes: 5,
      unitValue: 1200000,
      averageTicket: 400000,
      withValue: 3,
    });
    expect(s.byStage.find((b) => b.stage === 'cadastro')?.count).toBe(1);
    expect(s.byStage).toHaveLength(11);
    // reached index: cadastro 1, credit 2 (+ refused), legal 4 (pendência), signed 7
    expect(s.funnel.map((f) => f.reached)).toEqual([5, 5, 4, 2, 2, 1, 1, 1]);
    expect(s.funnel[1]).toEqual({
      stage: 'cadastro',
      reached: 5,
      pctOfTotal: 100,
      stepRate: 100,
    });
    expect(s.funnel[2].pctOfTotal).toBe(80);
    expect(s.funnel[0].stepRate).toBeNull();
  });

  it('period: new processes, entries per stage and average time in each stage', () => {
    const s = buildSummary(
      30,
      [
        snap('analise_credito', null, '2026-10-01T00:00:00Z'),
        snap('cadastro', null, '2026-08-01T00:00:00Z'),
      ],
      [
        {
          action: 'stage_change',
          from_state: 'inicial',
          to_state: 'cadastro',
          days_in_from: '2',
        },
        {
          action: 'stage_change',
          from_state: 'inicial',
          to_state: 'cadastro',
          days_in_from: '4',
        },
        {
          action: 'stage_change',
          from_state: 'cadastro',
          to_state: 'analise_credito',
          days_in_from: 3.25,
        },
        {
          action: 'stage_change',
          from_state: 'cartorio',
          to_state: 'assinatura',
          days_in_from: 10,
        },
        {
          action: 'stage_change_undo',
          from_state: 'analise_credito',
          to_state: 'cadastro',
          days_in_from: 1,
        },
        {
          action: 'stage_change',
          from_state: 'em_analise_banco',
          to_state: 'aprovado',
          days_in_from: 9,
        },
      ],
      NOW,
    );
    expect(s.period.newProcesses).toBe(1);
    expect(s.period.stageChanges).toBe(5);
    expect(s.period.signed).toBe(1);
    expect(s.period.entered.find((e) => e.stage === 'cadastro')?.count).toBe(2);
    const avg = Object.fromEntries(s.avgDaysInStage.map((a) => [a.stage, a]));
    expect(avg.inicial).toEqual({ stage: 'inicial', avgDays: 3, samples: 2 });
    expect(avg.cadastro.avgDays).toBe(3.3);
    expect(avg.cartorio.avgDays).toBe(10);
    expect(avg.analise_credito).toEqual({
      stage: 'analise_credito',
      avgDays: null,
      samples: 0,
    });
    expect(s.avgDaysInStage.some((a) => a.stage === 'assinatura')).toBe(false);
  });

  it('empty tenant', () => {
    const s = buildSummary(30, [], [], NOW);
    expect(s.totals.averageTicket).toBeNull();
    expect(s.funnel.every((f) => f.reached === 0 && f.pctOfTotal === 0)).toBe(
      true,
    );
  });
});

describe('DashboardService (BE-14)', () => {
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

  function make() {
    const dataSource = { query: jest.fn().mockResolvedValue([]) };
    const service = new DashboardService(dataSource as unknown as DataSource);
    return { service, dataSource };
  }

  it('scopes to the tenant (and to the analista own processes)', async () => {
    const { service, dataSource } = make();
    await service.summary(dono, '7');
    const calls = dataSource.query.mock.calls as [string, unknown[]][];
    expect(calls[0][0]).toContain('p.tenant_id = $1 AND p.active = true');
    expect(calls[0][1]).toEqual(['t1']);
    expect(calls[1][0]).toContain('make_interval(days => $2::int)');
    expect(calls[1][1]).toEqual(['t1', 7]);

    dataSource.query.mockClear();
    await service.summary(analista, '7');
    const own = dataSource.query.mock.calls as [string, unknown[]][];
    expect(own[0][0]).toContain('AND p.analista_id = $2');
    expect(own[0][1]).toEqual(['t1', 'a1']);
    expect(own[1][0]).toContain('make_interval(days => $3::int)');
    expect(own[1][1]).toEqual(['t1', 'a1', 7]);
  });

  it('caches for 5 minutes per tenant, view and period', async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const { service, dataSource } = make();
      const first = await service.summary(dono, '30');
      await service.summary(dono);
      expect(dataSource.query).toHaveBeenCalledTimes(2); // same key: cached
      await service.summary(dono, '7');
      await service.summary(analista, '30');
      expect(dataSource.query).toHaveBeenCalledTimes(6);
      jest.setSystemTime(NOW.getTime() + SUMMARY_TTL_MS);
      const again = await service.summary(dono, '30');
      expect(dataSource.query).toHaveBeenCalledTimes(8);
      expect(again).not.toBe(first);
    } finally {
      jest.useRealTimers();
    }
  });
});
