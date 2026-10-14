import { ConfigService } from '@nestjs/config';
import type { EntityManager } from 'typeorm';
import { MessagingService } from './messaging.service';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const people = {
  c1: { id: 'c1', name: 'Helena', email: 'helena@exemplo.dev' },
  an1: { id: 'an1', name: 'Rafael', email: 'rafael@exemplo.dev' },
};

function makeService() {
  const inserts: unknown[][] = [];
  const manager = {
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('FROM users')) {
        const ids = params[1] as string[];
        return Promise.resolve(
          Object.values(people).filter((p) => ids.includes(p.id)),
        );
      }
      if (sql.includes('FROM tenants'))
        return Promise.resolve([{ name: 'Assessoria Exemplo' }]);
      if (sql.includes('INSERT INTO message_outbox')) inserts.push(params);
      return Promise.resolve([]);
    }),
  };
  const worker = { soon: jest.fn() };
  const config = {
    get: (key: string) =>
      key === 'FRONTEND_URL'
        ? 'https://app.exemplo.dev,https://www.exemplo.dev'
        : undefined,
  } as unknown as ConfigService;
  const service = new MessagingService(config, worker as never);
  return {
    service,
    manager,
    inserts,
    worker,
    em: manager as unknown as EntityManager,
  };
}

const notice = {
  tenantId: TENANT,
  processId: 'p1',
  clientId: 'c1',
  analistaId: 'an1',
};

describe('MessagingService (BE-09_v2)', () => {
  it('queues the client e-mail through the caller transaction and wakes the worker', async () => {
    const { service, em, manager, inserts, worker } = makeService();
    const n = await service.stageChanged(em, {
      ...notice,
      fromStage: 'cadastro',
      toStage: 'analise_credito',
    });
    expect(n).toBe(1);
    expect(inserts).toHaveLength(1);
    const [tenantId, processId, eventType, role, to, subject, html, text] =
      inserts[0] as string[];
    expect([tenantId, processId, eventType, role, to]).toEqual([
      TENANT,
      'p1',
      'bank_analysis',
      'cliente',
      'helena@exemplo.dev',
    ]);
    expect(subject).toBe(
      'Flui Contratos — seu processo está em análise no banco',
    );
    expect(html).toContain('Assessoria Exemplo');
    // the first FRONTEND_URL is the portal link
    expect(text).toContain('https://app.exemplo.dev');
    expect(text).not.toContain('www.exemplo.dev');
    expect(manager.query).toHaveBeenCalled();
    expect(worker.soon).toHaveBeenCalledTimes(1);
  });

  it('RN-10: a pendência queues two messages, client and analista', async () => {
    const { service, em, inserts } = makeService();
    await service.stageChanged(em, {
      ...notice,
      fromStage: 'cadastro',
      toStage: 'processo_pendencia',
    });
    expect(inserts.map((p) => [p[3], p[4]])).toEqual([
      ['cliente', 'helena@exemplo.dev'],
      ['analista', 'rafael@exemplo.dev'],
    ]);
  });

  it('RN-01: recipients are looked up only inside the tenant of the event', async () => {
    const { service, em, manager } = makeService();
    await service.stageChanged(em, {
      ...notice,
      fromStage: 'inicial',
      toStage: 'cadastro',
    });
    const [sql, params] = manager.query.mock.calls.find(([s]) =>
      s.includes('FROM users'),
    ) as [string, unknown[]];
    expect(sql).toContain('tenant_id = $1');
    expect(params[0]).toBe(TENANT);
  });

  it('a client from another tenant (or without e-mail) gets nothing', async () => {
    const { service, em, inserts, worker } = makeService();
    const n = await service.stageChanged(em, {
      ...notice,
      clientId: 'someone-else',
      analistaId: null,
      fromStage: 'inicial',
      toStage: 'cadastro',
    });
    expect(n).toBe(0);
    expect(inserts).toHaveLength(0);
    expect(worker.soon).not.toHaveBeenCalled();
  });

  it('documents requested and document rejected are queued for the client', async () => {
    const { service, em, inserts } = makeService();
    await service.documentsRequested(em, {
      tenantId: TENANT,
      processId: 'p1',
      clientId: 'c1',
      labels: ['RG ou CNH'],
    });
    await service.documentRejected(em, {
      tenantId: TENANT,
      processId: null,
      clientId: 'c1',
      label: 'RG ou CNH',
      notes: 'Foto ilegível',
    });
    expect(inserts.map((p) => [p[1], p[2], p[4]])).toEqual([
      ['p1', 'documents_requested', 'helena@exemplo.dev'],
      [null, 'document_rejected', 'helena@exemplo.dev'],
    ]);
  });
});
