import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { NOTIFY_ACTIONS, NotificationsService } from './notifications.service';

const user = (role: string, userId = 'u1') =>
  ({ tenantId: 't1', userId, role }) as RequestUserFull;

function make() {
  const dataSource = { query: jest.fn() };
  const service = new NotificationsService(dataSource as unknown as DataSource);
  return { service, dataSource };
}

const row = {
  id: 'n1',
  action: 'document_upload',
  process_id: 'p1',
  from_state: null,
  to_state: null,
  metadata: { docId: 'd1', label: 'RG ou CNH', fileName: 'rg-helena.pdf' },
  created_at: new Date('2026-10-08T12:00:00Z'),
  actor_name: 'Helena',
  client_name: 'Helena',
  client_email: 'h@x.dev',
  read: false,
};

describe('NotificationsService (FE-29)', () => {
  it('lists the tenant events for the gestor, without their own actions', async () => {
    const { service, dataSource } = make();
    dataSource.query
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ unread: '3' }])
      .mockResolvedValueOnce([{ n: '2' }]);
    const res = await service.list(user('dono', 'g1'));
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('al.tenant_id = $1');
    expect(sql).toContain('al.actor_id IS DISTINCT FROM $2');
    expect(sql).toContain("interval '30 days'");
    expect(sql).not.toContain('p.analista_id');
    expect(sql).not.toContain('p.client_id = $2');
    expect(params).toEqual(['t1', 'g1', NOTIFY_ACTIONS.dono]);
    expect(res.unread).toBe(3);
    expect(res.pendingDocs).toBe(2);
    // only the document name leaves the API (no file name)
    expect(res.items).toEqual([
      {
        id: 'n1',
        action: 'document_upload',
        processId: 'p1',
        fromState: null,
        toState: null,
        label: 'RG ou CNH',
        labels: null,
        actorName: 'Helena',
        clientName: 'Helena',
        createdAt: row.created_at,
        read: false,
      },
    ]);
    const [pendingSql] = dataSource.query.mock.calls[2] as [string];
    expect(pendingSql).toContain("status = 'recebido'");
  });

  it('analista sees only their processes; cliente only theirs and their documents to send', async () => {
    const { service, dataSource } = make();
    dataSource.query.mockResolvedValue([{ unread: '0', n: '0' }]);
    await service.list(user('analista', 'a1'));
    const calls = dataSource.query.mock.calls as [string, unknown[]][];
    expect(calls[0][0]).toContain('AND p.analista_id = $2');
    expect(calls[0][1]).toEqual(['t1', 'a1', NOTIFY_ACTIONS.analista]);
    expect(calls[2][0]).toContain('p.analista_id = $2');

    dataSource.query.mockClear();
    await service.list(user('cliente', 'c1'));
    const cli = dataSource.query.mock.calls as [string, unknown[]][];
    expect(cli[0][0]).toContain('AND p.client_id = $2');
    expect(cli[0][1]).toEqual(['t1', 'c1', NOTIFY_ACTIONS.cliente]);
    expect(cli[2][0]).toContain("d.status IN ('pendente', 'rejeitado')");
    expect(cli[2][1]).toEqual(['t1', 'c1']);
    expect(NOTIFY_ACTIONS.cliente).not.toContain('document_upload');
  });

  it('marks one event read only inside the tenant, idempotently', async () => {
    const { service, dataSource } = make();
    dataSource.query.mockResolvedValue([]);
    await service.markRead('n1', user('analista', 'a1'));
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE al.id = $3 AND al.tenant_id = $1');
    expect(sql).toContain('ON CONFLICT (user_id, audit_log_id) DO NOTHING');
    expect(params).toEqual(['t1', 'a1', 'n1']);
  });

  it('marks all visible unread events', async () => {
    const { service, dataSource } = make();
    dataSource.query.mockResolvedValue([]);
    await service.markAllRead(user('cliente', 'c1'));
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO notification_reads');
    expect(sql).toContain('AND p.client_id = $2');
    expect(sql).toContain('nr.audit_log_id IS NULL');
    expect(params).toEqual(['t1', 'c1', NOTIFY_ACTIONS.cliente]);
  });
});
