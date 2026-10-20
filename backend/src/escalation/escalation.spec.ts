import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { MessagingService } from '../messaging/messaging.service';
import { processStalledMessages } from '../messaging/message-templates';
import { brtHour, EscalationJob, nextRunAt } from './escalation.job';
import { ESCALATION_LOCK, EscalationService } from './escalation.service';

const cfg = (values: Record<string, string> = {}) =>
  ({
    get: (k: string, d?: unknown) => values[k] ?? d,
  }) as unknown as ConfigService;

const stalledRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  tenant_id: 't1',
  stage: 'cadastro',
  analista_id: 'a1',
  analista_status: 'active',
  analista_name: 'Ana',
  client_name: 'Carla',
  stage_since: new Date('2026-10-09T12:00:00Z'),
  days: 10,
  ...over,
});

function setup(
  row: Record<string, unknown> | null,
  gestores = [{ id: 'g1' }, { id: 'g2' }],
) {
  const sqls: { sql: string; params: unknown[] }[] = [];
  const manager = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
      if (sql.includes('AND p.id = $3'))
        return Promise.resolve(row ? [row] : []);
      if (sql.includes("role = 'dono'")) return Promise.resolve(gestores);
      if (sql.includes('INSERT INTO process_escalations'))
        return Promise.resolve([{ id: 'e1' }]);
      return Promise.resolve([]);
    }),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue(row ? [{ id: 'p1' }] : []),
    transaction: jest.fn((fn: (m: EntityManager) => Promise<unknown>) =>
      fn(manager as unknown as EntityManager),
    ),
  };
  const messaging = { processStalled: jest.fn().mockResolvedValue(1) };
  const service = new EscalationService(
    dataSource as unknown as DataSource,
    messaging as unknown as MessagingService,
    cfg({ ESCALATION_DAYS: '7' }),
  );
  return { service, sqls, messaging, dataSource };
}

describe('EscalationService (PROD-05_v2)', () => {
  it('prazo vem de ESCALATION_DAYS; padrão = 7 dias (o mesmo SLA do PROD-10)', () => {
    const svc = (v: Record<string, string>) =>
      new EscalationService({} as DataSource, {} as MessagingService, cfg(v));
    expect(svc({}).days).toBe(7);
    expect(svc({ ESCALATION_DAYS: '10' }).days).toBe(10);
    expect(svc({ ESCALATION_DAYS: '0' }).days).toBe(7);
    expect(svc({ ESCALATION_DAYS: 'abc' }).days).toBe(7);
  });

  it('a busca exclui Assinatura, Inativo e Crédito Recusado e quem já foi alertado nos últimos N dias', async () => {
    const { service, dataSource } = setup(null);
    await service.run();
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      ['assinatura', 'cliente_inativo', 'credito_recusado'],
      7,
    ]);
    expect(sql).toContain('p.active = true');
    expect(sql).toContain('p.stage <> ALL($1::text[])');
    expect(sql).toContain("al.action IN ('stage_change', 'stage_change_undo')");
    expect(sql).toContain('FROM process_escalations e');
  });

  it('trava o processo, confere de novo e grava alerta + e-mail na mesma transação', async () => {
    const { service, sqls, messaging } = setup(stalledRow());
    const r = await service.run();
    expect(r).toEqual({
      days: 7,
      checked: 1,
      alerted: 1,
      messages: 1,
      skipped: 0,
      failed: 0,
    });
    expect(sqls[0]).toEqual({
      sql: 'SELECT pg_advisory_xact_lock($1, hashtext($2))',
      params: [ESCALATION_LOCK, 'p1'],
    });
    expect(sqls[1].params).toEqual([
      ['assinatura', 'cliente_inativo', 'credito_recusado'],
      7,
      'p1',
    ]);
    const insert = sqls.find((s) =>
      s.sql.includes('INSERT INTO process_escalations'),
    )!;
    expect(insert.params).toEqual([
      't1',
      'p1',
      'cadastro',
      stalledRow().stage_since,
      10,
      'analista',
      ['a1'],
    ]);
    expect(messaging.processStalled).toHaveBeenCalledWith(expect.anything(), {
      tenantId: 't1',
      processId: 'p1',
      clientName: 'Carla',
      stage: 'cadastro',
      days: 10,
      since: stalledRow().stage_since,
      limitDays: 7,
      reason: 'analista',
      analistaName: 'Ana',
      recipients: [{ id: 'a1', role: 'analista' }],
    });
    expect(sqls.at(-1)).toEqual({
      sql: 'UPDATE process_escalations SET messages = $1 WHERE id = $2',
      params: [1, 'e1'],
    });
  });

  it.each([
    [
      'sem analista',
      { analista_id: null, analista_name: null },
      'sem_analista',
    ],
    [
      'com o analista desativado',
      { analista_status: 'disabled' },
      'analista_desativado',
    ],
  ])(
    '%s: os gestores ativos da assessoria recebem',
    async (_c, over, reason) => {
      const { service, sqls, messaging } = setup(stalledRow(over));
      await service.run();
      const gestores = sqls.find((s) => s.sql.includes("role = 'dono'"))!;
      expect(gestores.params).toEqual(['t1']);
      expect(gestores.sql).toContain("status <> 'disabled'");
      expect(messaging.processStalled).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          reason,
          recipients: [
            { id: 'g1', role: 'gestor' },
            { id: 'g2', role: 'gestor' },
          ],
        }),
      );
    },
  );

  it('se outra instância já alertou (rechecagem vazia), não grava nada', async () => {
    const { service, sqls, messaging, dataSource } = setup(null);
    dataSource.query.mockResolvedValue([{ id: 'p1' }]);
    const r = await service.run();
    expect(r).toMatchObject({ checked: 1, alerted: 0, skipped: 1 });
    expect(sqls.some((s) => s.sql.includes('INSERT'))).toBe(false);
    expect(messaging.processStalled).not.toHaveBeenCalled();
  });

  it('um processo com erro não impede os outros', async () => {
    const { service, messaging, dataSource } = setup(stalledRow());
    dataSource.query.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    messaging.processStalled
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce(2);
    expect(await service.run()).toMatchObject({
      checked: 2,
      alerted: 1,
      messages: 2,
      failed: 1,
    });
  });
});

describe('agendamento diário (PROD-05_v2)', () => {
  it('próxima execução às 8h de Brasília (11h UTC): hoje se ainda não passou, senão amanhã', () => {
    expect(nextRunAt(new Date('2026-10-20T10:59:00Z'), 8).toISOString()).toBe(
      '2026-10-20T11:00:00.000Z',
    );
    expect(nextRunAt(new Date('2026-10-20T11:00:00Z'), 8).toISOString()).toBe(
      '2026-10-21T11:00:00.000Z',
    );
    // 23h de Brasília do dia 20 = 02h UTC do dia 21: a próxima é 8h do dia 21
    expect(nextRunAt(new Date('2026-10-21T02:00:00Z'), 8).toISOString()).toBe(
      '2026-10-21T11:00:00.000Z',
    );
    expect(nextRunAt(new Date('2026-12-31T20:00:00Z'), 8).toISOString()).toBe(
      '2027-01-01T11:00:00.000Z',
    );
    expect(brtHour(new Date('2026-10-20T02:30:00Z'))).toBe(23);
  });

  it('ESCALATION_ENABLED=off não agenda nada; execuções simultâneas viram uma só', async () => {
    const run = jest.fn().mockResolvedValue({
      checked: 0,
      alerted: 0,
      messages: 0,
      skipped: 0,
      failed: 0,
    });
    const off = new EscalationJob(
      { run, days: 7 } as unknown as EscalationService,
      cfg({ ESCALATION_ENABLED: 'off' }),
    );
    off.onApplicationBootstrap();
    off.onModuleDestroy();
    const job = new EscalationJob(
      { run, days: 7 } as unknown as EscalationService,
      cfg(),
    );
    await Promise.all([job.tick(), job.tick()]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('e-mail de processo parado (PROD-05_v2)', () => {
  const ctx = {
    tenantName: 'Assessoria Alfa',
    portalUrl: 'https://app.exemplo.dev',
  };
  const base = {
    clientName: 'Carla <b>',
    stage: 'analise_credito' as const,
    days: 9,
    since: new Date('2026-10-11T15:00:00Z'),
    limitDays: 7,
    analistaName: 'Davi',
  };

  it('analista: etapa, dias, desde quando e o prazo; HTML escapado', () => {
    const [m] = processStalledMessages(
      {
        ...base,
        reason: 'analista',
        recipients: [
          { person: { name: 'Ana', email: 'ana@x' }, role: 'analista' },
        ],
      },
      ctx,
    );
    expect(m).toMatchObject({
      eventType: 'process_stalled',
      recipientRole: 'analista',
      to: 'ana@x',
      subject: 'Flui — processo parado há 9 dias: Carla <b>',
    });
    expect(m.text).toContain(
      'O processo de Carla <b> está na etapa Análise de Crédito há 9 dias (desde 11/10/2026), acima do prazo de 7 dias.',
    );
    expect(m.html).toContain('Carla &lt;b&gt;');
    expect(m.html).not.toContain('Carla <b>');
  });

  it('gestores: um e-mail para cada, com o motivo', () => {
    const msgs = processStalledMessages(
      {
        ...base,
        reason: 'analista_desativado',
        recipients: [
          { person: { name: 'G1', email: 'g1@x' }, role: 'gestor' },
          { person: { name: 'G2', email: 'g2@x' }, role: 'gestor' },
        ],
      },
      ctx,
    );
    expect(msgs.map((m) => [m.to, m.recipientRole])).toEqual([
      ['g1@x', 'gestor'],
      ['g2@x', 'gestor'],
    ]);
    expect(msgs[0].text).toContain(
      'O analista responsável (Davi) está desativado',
    );
    const sem = processStalledMessages(
      {
        ...base,
        reason: 'sem_analista',
        recipients: [{ person: { name: null, email: 'g@x' }, role: 'gestor' }],
      },
      ctx,
    );
    expect(sem[0].text).toContain('não tem analista responsável');
    expect(sem[0].text).toContain('Olá, gestor!');
  });
});
