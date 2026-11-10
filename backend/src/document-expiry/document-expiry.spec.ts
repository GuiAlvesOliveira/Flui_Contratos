import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import { DocumentExpiryJob } from './document-expiry.job';
import {
  DOCUMENT_EXPIRY_LOCK,
  DocumentExpiryService,
  expiryMessage,
} from './document-expiry.service';

const cfg = (values: Record<string, string> = {}) =>
  ({
    get: (k: string, d?: unknown) => values[k] ?? d,
  }) as unknown as ConfigService;

const docRow = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  tenant_id: 't1',
  process_id: 'p1',
  user_id: 'c1',
  label: 'Extrato Bancário (mês 1)',
  valid_until: '2026-06-30',
  expired_at: null,
  client_name: 'Carla Cliente',
  client_status: 'active',
  ...over,
});

// Banco simulado: responde cada consulta da rotina pelo trecho do SQL
function setup(opts: {
  doc?: Record<string, unknown> | null;
  processes?: Record<string, unknown>[];
  existing?: string[]; // destinatários que já têm o aviso deste ciclo
  gestores?: { id: string }[];
}) {
  const sqls: { sql: string; params: unknown[] }[] = [];
  const doc = opts.doc === undefined ? docRow() : opts.doc;
  const manager = {
    query: jest.fn((sql: string, params: unknown[] = []) => {
      sqls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
      if (sql.includes('FOR UPDATE OF d'))
        return Promise.resolve(doc ? [doc] : []);
      if (sql.includes('FROM processes p'))
        return Promise.resolve(
          opts.processes ?? [
            { id: 'p1', analista_id: 'a1', analista_status: 'active' },
          ],
        );
      if (sql.includes("role = 'dono'"))
        return Promise.resolve(opts.gestores ?? [{ id: 'g1' }]);
      if (sql.startsWith('SELECT 1 FROM notifications'))
        return Promise.resolve(
          (opts.existing ?? []).includes(params[2] as string) ? [{}] : [],
        );
      if (sql.includes('INSERT INTO notifications'))
        return Promise.resolve([{ id: `n-${String(params[2])}` }]);
      return Promise.resolve([]);
    }),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue(doc ? [{ id: 'd1' }] : []),
    transaction: jest.fn((fn: (m: EntityManager) => Promise<unknown>) =>
      fn(manager as unknown as EntityManager),
    ),
  };
  const service = new DocumentExpiryService(
    dataSource as unknown as DataSource,
  );
  const inserted = () =>
    sqls
      .filter((q) => q.sql.includes('INSERT INTO notifications'))
      .map((q) => ({
        processId: q.params[1],
        recipient: q.params[2],
        kind: q.params[4],
        message: q.params[5],
      }));
  const audits = () =>
    sqls
      .filter((q) => q.sql.includes('INSERT INTO audit_logs'))
      .map((q) => ({
        processId: q.params[1],
        action: q.params[2],
        meta: JSON.parse(q.params[3] as string) as Record<string, unknown>,
      }));
  return { service, sqls, inserted, audits, dataSource };
}

describe('Validade de documentos — textos dos avisos', () => {
  const doc = {
    label: 'Extrato Bancário (mês 1)',
    validUntil: '2026-06-30',
    clientName: 'Carla Cliente',
  };

  it('cliente: vencendo e vencido, com a data e o que fazer', () => {
    expect(
      expiryMessage('document_expiring', 'cliente', doc, '2026-06-15'),
    ).toBe(
      'Seu documento "Extrato Bancário (mês 1)" vence em 15 dias (30/06/2026). Envie um documento mais recente.',
    );
    expect(
      expiryMessage('document_expiring', 'cliente', doc, '2026-06-30'),
    ).toBe(
      'Seu documento "Extrato Bancário (mês 1)" vence hoje (30/06/2026). Envie um documento mais recente.',
    );
    expect(
      expiryMessage('document_expired', 'cliente', doc, '2026-07-01'),
    ).toBe(
      'Seu documento "Extrato Bancário (mês 1)" está vencido (valia até 30/06/2026). Envie um documento mais recente para o processo continuar.',
    );
  });

  it('equipe: com o nome do cliente', () => {
    expect(
      expiryMessage('document_expiring', 'analista', doc, '2026-06-20'),
    ).toBe(
      '"Extrato Bancário (mês 1)" de Carla Cliente vence em 10 dias (30/06/2026). Peça um documento mais recente ao cliente.',
    );
    expect(expiryMessage('document_expired', 'gestor', doc, '2026-07-01')).toBe(
      '"Extrato Bancário (mês 1)" de Carla Cliente está vencido (valia até 30/06/2026). O processo não avança de etapa até um documento novo ser validado.',
    );
  });
});

describe('Validade de documentos — rotina diária', () => {
  it('faltando 15 dias: aviso "vencendo" ao cliente e ao analista, cada um registrado no histórico', async () => {
    const { service, sqls, inserted, audits } = setup({});
    const r = await service.processDocument('d1', '2026-06-15');
    expect(r).toEqual({ expired: false, created: 2 });
    // trava do documento antes de tudo
    expect(sqls[0].params).toEqual([DOCUMENT_EXPIRY_LOCK, 'd1']);
    expect(inserted()).toEqual([
      expect.objectContaining({
        processId: 'p1',
        recipient: 'c1',
        kind: 'document_expiring',
      }),
      expect.objectContaining({
        processId: 'p1',
        recipient: 'a1',
        kind: 'document_expiring',
      }),
    ]);
    expect(audits().map((a) => [a.action, a.meta.recipientRole])).toEqual([
      ['document_expiry_notice', 'cliente'],
      ['document_expiry_notice', 'analista'],
    ]);
    // não marca vencido antes da hora
    expect(sqls.some((q) => q.sql.includes('SET expired_at'))).toBe(false);
  });

  it('confere se o aviso já existe antes de criar — quem já recebeu não recebe de novo', async () => {
    const { service, sqls, inserted } = setup({ existing: ['c1'] });
    const r = await service.processDocument('d1', '2026-06-15');
    expect(r).toEqual({ expired: false, created: 1 });
    expect(inserted().map((n) => n.recipient)).toEqual(['a1']);
    const check = sqls.find((q) =>
      q.sql.startsWith('SELECT 1 FROM notifications'),
    );
    expect(check?.params).toEqual([
      'd1',
      'document_expiring',
      'c1',
      '2026-06-30',
    ]);
    // e o INSERT ainda tem a rede do índice único (duas instâncias ao mesmo tempo)
    const insert = sqls.find((q) =>
      q.sql.includes('INSERT INTO notifications'),
    );
    expect(insert?.sql).toContain(
      'ON CONFLICT (document_id, kind, recipient_id, valid_until) DO NOTHING',
    );
  });

  it('no dia seguinte ao vencimento: marca vencido (pendência), registra e avisa "vencido"', async () => {
    const { service, sqls, inserted, audits } = setup({});
    const r = await service.processDocument('d1', '2026-07-01');
    expect(r).toEqual({ expired: true, created: 2 });
    expect(
      sqls.some((q) =>
        q.sql.includes('UPDATE documents SET expired_at = now()'),
      ),
    ).toBe(true);
    expect(inserted().every((n) => n.kind === 'document_expired')).toBe(true);
    expect(audits()[0]).toEqual({
      processId: 'p1',
      action: 'document_expired',
      meta: {
        docId: 'd1',
        label: 'Extrato Bancário (mês 1)',
        validUntil: '2026-06-30',
      },
    });
  });

  it('vencido já marcado não é marcado de novo', async () => {
    const { service, sqls } = setup({
      doc: docRow({ expired_at: new Date() }),
      existing: ['c1', 'a1'],
    });
    expect(await service.processDocument('d1', '2026-07-05')).toEqual({
      expired: false,
      created: 0,
    });
    expect(sqls.some((q) => q.sql.includes('SET expired_at'))).toBe(false);
  });

  it('sem analista ativo no processo, os gestores recebem no lugar dele', async () => {
    const { service, inserted } = setup({
      processes: [{ id: 'p1', analista_id: 'a1', analista_status: 'disabled' }],
      gestores: [{ id: 'g1' }, { id: 'g2' }],
    });
    await service.processDocument('d1', '2026-06-20');
    expect(inserted().map((n) => n.recipient)).toEqual(['c1', 'g1', 'g2']);
  });

  it('documento pessoal (comprovante de endereço): avisa o analista de cada processo do cliente, uma vez por pessoa', async () => {
    const { service, inserted } = setup({
      doc: docRow({ process_id: null, label: 'Comprovante de Endereço' }),
      processes: [
        { id: 'p1', analista_id: 'a1', analista_status: 'active' },
        { id: 'p2', analista_id: 'a2', analista_status: 'active' },
        { id: 'p3', analista_id: 'a1', analista_status: 'active' },
      ],
    });
    await service.processDocument('d1', '2026-06-20');
    expect(inserted().map((n) => [n.recipient, n.processId])).toEqual([
      ['c1', 'p1'], // o cliente vai para o primeiro processo dele
      ['a1', 'p1'],
      ['a2', 'p2'],
    ]);
  });

  it('cliente desativado não recebe; documento sem processo em andamento é ignorado', async () => {
    const off = setup({ doc: docRow({ client_status: 'disabled' }) });
    await off.service.processDocument('d1', '2026-06-20');
    expect(off.inserted().map((n) => n.recipient)).toEqual(['a1']);

    const closed = setup({ processes: [] });
    expect(await closed.service.processDocument('d1', '2026-06-20')).toBeNull();
    expect(closed.inserted()).toEqual([]);
  });

  it('a verificação usa o dia de São Paulo e conta o resultado', async () => {
    const { service, dataSource } = setup({});
    const r = await service.run(new Date('2026-07-01T02:00:00Z')); // 30/06 às 23h em SP
    expect(r.today).toBe('2026-06-30');
    expect((dataSource.query.mock.calls[0] as [string, unknown[]])[1][0]).toBe(
      '2026-06-30',
    );
    expect(r).toMatchObject({
      checked: 1,
      expired: 0,
      notifications: 2,
      skipped: 0,
      failed: 0,
    });
  });
});

describe('Validade de documentos — agendamento', () => {
  it('DOCUMENT_EXPIRY_ENABLED=off (ou false) desliga a rotina', () => {
    for (const flag of ['off', 'false', 'FALSE']) {
      const job = new DocumentExpiryJob(
        { run: jest.fn() } as never,
        cfg({ DOCUMENT_EXPIRY_ENABLED: flag }),
      );
      const spy = jest.spyOn(global, 'setTimeout');
      job.onApplicationBootstrap();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('ligada: agenda a próxima execução e uma verificação logo depois do boot', () => {
    jest.useFakeTimers();
    const run = jest
      .fn()
      .mockResolvedValue({
        today: '2026-06-30',
        checked: 0,
        expired: 0,
        notifications: 0,
        skipped: 0,
        failed: 0,
      });
    const job = new DocumentExpiryJob({ run } as never, cfg());
    job.onApplicationBootstrap();
    jest.advanceTimersByTime(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    job.onModuleDestroy();
    jest.useRealTimers();
  });
});
