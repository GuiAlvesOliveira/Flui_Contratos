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

describe('NotificationsService — avisos de validade de documentos', () => {
  const alert = {
    id: 'al1',
    kind: 'document_expiring',
    process_id: 'p1',
    document_id: 'd1',
    message:
      'Seu documento "Extrato Bancário (mês 1)" vence em 15 dias (30/06/2026). Envie um documento mais recente.',
    valid_until: '2026-06-30',
    created_at: new Date('2026-06-15T10:00:00Z'),
    read_at: null,
    resolved_at: null,
    unread_total: '2',
  };

  it('a lista traz os avisos do próprio usuário, e os não lidos entram no contador', async () => {
    const { service, dataSource } = make();
    dataSource.query
      .mockResolvedValueOnce([]) // eventos
      .mockResolvedValueOnce([{ unread: '1' }])
      .mockResolvedValueOnce([{ n: '0' }])
      .mockResolvedValueOnce([
        alert,
        {
          ...alert,
          id: 'al2',
          kind: 'document_expired',
          read_at: new Date(),
          resolved_at: new Date(),
        },
      ]);
    const res = await service.list(user('cliente', 'c1'));
    const [sql, params] = dataSource.query.mock.calls[3] as [string, unknown[]];
    // só os avisos da assessoria do usuário e endereçados a ele
    expect(sql).toContain('FROM notifications n');
    expect(sql).toContain('n.tenant_id = $1 AND n.recipient_id = $2');
    expect(sql).toContain('p.active = true');
    expect(params).toEqual(['t1', 'c1']);
    expect(res.unread).toBe(3); // 1 evento + 2 avisos
    expect(res.alerts).toEqual([
      {
        id: 'al1',
        kind: 'document_expiring',
        processId: 'p1',
        documentId: 'd1',
        message: alert.message,
        validUntil: '2026-06-30',
        createdAt: alert.created_at,
        read: false,
        resolved: false,
      },
      expect.objectContaining({ id: 'al2', read: true, resolved: true }),
    ]);
  });

  it('sem avisos, o contador é só o dos eventos', async () => {
    const { service, dataSource } = make();
    dataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ unread: '4' }])
      .mockResolvedValueOnce([{ n: '0' }])
      .mockResolvedValueOnce([]);
    const res = await service.list(user('analista', 'a1'));
    expect(res.unread).toBe(4);
    expect(res.alerts).toEqual([]);
  });

  it('o cliente conta como "para enviar" também os validados que venceram', async () => {
    const { service, dataSource } = make();
    dataSource.query.mockResolvedValue([{ unread: '0', n: '0' }]);
    await service.list(user('cliente', 'c1'));
    const [sql] = dataSource.query.mock.calls[2] as [string];
    expect(sql).toContain("d.status = 'validado' AND d.valid_until <");
    expect(sql).toContain("AT TIME ZONE 'America/Sao_Paulo'");
  });

  it('marcar como lido só alcança aviso do próprio usuário, na assessoria dele', async () => {
    const { service, dataSource } = make();
    dataSource.query.mockResolvedValue([]);
    await service.markRead('al1', user('cliente', 'c1'));
    const [sql, params] = dataSource.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE notifications SET read_at = now()');
    expect(sql).toContain('id = $3 AND tenant_id = $1 AND recipient_id = $2');
    expect(params).toEqual(['t1', 'c1', 'al1']);
  });

  it('marcar todas também lê os avisos do usuário (e só os dele)', async () => {
    const { service, dataSource } = make();
    dataSource.query.mockResolvedValue([]);
    await service.markAllRead(user('analista', 'a1'));
    const [sql, params] = dataSource.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('UPDATE notifications SET read_at = now()');
    expect(sql).toContain('tenant_id = $1 AND recipient_id = $2');
    expect(params).toEqual(['t1', 'a1']);
  });
});
