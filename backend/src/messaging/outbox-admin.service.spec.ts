import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { RequestUserFull } from '../auth/supabase.guard';
import type { DirectGate, DirectSend } from '../email/email.service';
import { OutboxAdminService } from './outbox-admin.service';
import { TENANT_MAX_DAILY_LIMIT } from './outbox.worker';

const TENANT = 'a0000000-0000-4000-8000-000000000001';
const gestor = {
  tenantId: TENANT,
  userId: 'g1',
  role: 'dono',
} as RequestUserFull;

type Query = [sql: string, params: unknown[]];

// `answer` decides what each statement returns; every statement is recorded.
function makeService(
  answer: (sql: string, params: unknown[]) => unknown = () => [],
  opts: { globalLimit?: number } = {},
) {
  const queries: Query[] = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    queries.push([sql, params]);
    return Promise.resolve(answer(sql, params));
  });
  const manager = { query } as unknown as EntityManager;
  const dataSource = {
    query,
    transaction: jest.fn((cb: (m: EntityManager) => unknown) => cb(manager)),
  } as unknown as DataSource;
  let listener: ((sent: DirectSend) => void) | undefined;
  let gate: DirectGate | undefined;
  const email = {
    isConfigured: true,
    sender: 'Flui <noreply@exemplo.dev>',
    onDirectSend: jest.fn((l: (sent: DirectSend) => void) => (listener = l)),
    setDirectGate: jest.fn((g: DirectGate) => (gate = g)),
  };
  const worker = {
    isRunning: true,
    dailyLimit: opts.globalLimit ?? 250,
    soon: jest.fn(),
  };
  const service = new OutboxAdminService(
    dataSource,
    email as never,
    worker as never,
  );
  const find = (part: string) => queries.filter(([sql]) => sql.includes(part));
  return {
    service,
    queries,
    find,
    worker,
    email,
    listener: () => listener!,
    gate: () => gate!,
  };
}

describe('OutboxAdminService: the gestor controls the e-mails', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('RN-01: always inside the assessoria of who calls', () => {
    it('every statement of every operation is filtered by the caller tenant', async () => {
      const { service, queries } = makeService((sql) => {
        if (sql.includes('FROM tenants t'))
          return [
            {
              email_mode: 'manual',
              email_daily_limit: 100,
              held: 0,
              pending: 0,
              failed: 0,
              sent_today: 0,
            },
          ];
        if (sql.includes('SELECT id, subject, recipient, html, text'))
          return [
            { id: 'm1', subject: 's', recipient: 'r', html: 'h', text: 't' },
          ];
        if (sql.includes('WITH moved')) return [{ '?column?': 1 }];
        return [];
      });
      await service.settings(gestor);
      await service.list(gestor, {});
      await service.content('m1', gestor);
      await service.release({ ids: ['m1'] }, gestor);
      await service.cancel({ all: true }, gestor);
      await service.resend('m1', gestor);
      expect(queries.length).toBeGreaterThanOrEqual(7);
      for (const [sql, params] of queries) {
        // the caller's tenant is a parameter, and the statement filters by it
        const n = params.indexOf(TENANT) + 1;
        expect(n).toBeGreaterThan(0);
        expect(
          sql.includes(`tenant_id = $${n}`) || sql.includes(`t.id = $${n}`),
        ).toBe(true);
      }
    });

    it('a message of another assessoria is "not found"', async () => {
      const { service } = makeService(() => []);
      await expect(
        service.content('m-de-outra', gestor),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.resend('m-de-outra', gestor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('an account without assessoria has nothing to control', async () => {
      const { service, queries } = makeService();
      const admin = { ...gestor, tenantId: null } as RequestUserFull;
      await expect(service.settings(admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.release({ all: true }, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(queries).toHaveLength(0);
    });
  });

  describe('release, cancel and resend', () => {
    const moved = (n: number) => (sql: string) =>
      sql.includes('WITH moved') ? Array.from({ length: n }, () => ({})) : [];

    it("release: only what is 'held' goes to the queue, and the worker is woken", async () => {
      const { service, find, worker } = makeService(moved(2));
      await expect(
        service.release({ ids: ['m1', 'm2'] }, gestor),
      ).resolves.toEqual({ released: 2 });
      const [[sql, params]] = find('WITH moved');
      expect(sql).toContain("WHERE tenant_id = $1 AND status = 'held'");
      expect(sql).toContain("SET status = 'pending', attempts = 0");
      expect(sql).toContain('AND id = ANY($4::uuid[])');
      expect(params).toEqual([TENANT, 'g1', 'email_released', ['m1', 'm2']]);
      expect(worker.soon).toHaveBeenCalledTimes(1);
    });

    it('release "all" takes every held message of the assessoria (the daily limit still applies in the worker)', async () => {
      const { service, find } = makeService(moved(40));
      await expect(service.release({ all: true }, gestor)).resolves.toEqual({
        released: 40,
      });
      const [[sql, params]] = find('WITH moved');
      expect(sql).not.toContain('ANY(');
      expect(params).toEqual([TENANT, 'g1', 'email_released']);
    });

    it('nothing released: the worker is left alone', async () => {
      const { service, worker } = makeService(moved(0));
      await expect(service.release({ ids: ['m1'] }, gestor)).resolves.toEqual({
        released: 0,
      });
      expect(worker.soon).not.toHaveBeenCalled();
    });

    it("cancel: what has not left yet ('held' or 'pending') will not be sent", async () => {
      const { service, find, worker } = makeService(moved(3));
      await expect(service.cancel({ ids: ['m1'] }, gestor)).resolves.toEqual({
        cancelled: 3,
      });
      const [[sql, params]] = find('WITH moved');
      expect(sql).toContain("status IN ('held', 'pending')");
      expect(sql).toContain("SET status = 'cancelled'");
      expect(params[2]).toBe('email_cancelled');
      expect(worker.soon).not.toHaveBeenCalled();
    });

    it('RN-07: the change and its entry in the Log de Ações are one statement, with who did it', async () => {
      const { service, find } = makeService(moved(1));
      await service.release({ ids: ['m1'] }, gestor);
      const [[sql]] = find('WITH moved');
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(sql).toContain('$2::uuid, $3::varchar');
      // the Log keeps the subject and the role, not the address
      expect(sql).not.toMatch(/'recipient',/);
    });

    it('without choosing messages (and without "all") nothing is touched', async () => {
      const { service, queries } = makeService();
      for (const sel of [{}, { ids: [] }, { all: false }]) {
        await expect(service.release(sel, gestor)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        await expect(service.cancel(sel, gestor)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
      expect(queries).toHaveLength(0);
    });

    it('resend: a failed, expired or cancelled message goes back to the queue', async () => {
      const { service, find, worker } = makeService(moved(1));
      await expect(service.resend('m1', gestor)).resolves.toEqual({
        resent: 1,
      });
      const [[sql, params]] = find('WITH moved');
      expect(sql).toContain("status IN ('failed', 'expired', 'cancelled')");
      expect(params).toEqual([TENANT, 'g1', 'email_resent', ['m1']]);
      expect(worker.soon).toHaveBeenCalled();
    });

    it('resend: a message already sent is refused (no duplicate)', async () => {
      const { service, worker } = makeService((sql) =>
        sql.includes('SELECT status')
          ? [{ status: 'sent', has_content: true }]
          : [],
      );
      await expect(service.resend('m1', gestor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(worker.soon).not.toHaveBeenCalled();
    });

    it('resend: an invite or password reset has no stored content, so it cannot leave again', async () => {
      const { service, find } = makeService((sql) =>
        sql.includes('SELECT status')
          ? [{ status: 'failed', has_content: false }]
          : [],
      );
      await expect(service.resend('m1', gestor)).rejects.toThrow(
        /Convites e redefinições de senha não ficam guardados/,
      );
      expect(find('WITH moved')[0][0]).toContain("AND html <> ''");
    });
  });

  describe('settings: mode and daily limit', () => {
    const tenantRow = (mode: string, limit: number) => (sql: string) => {
      if (sql.includes('FOR UPDATE'))
        return [{ email_mode: mode, email_daily_limit: limit }];
      if (sql.includes('FROM tenants t'))
        return [
          {
            email_mode: mode,
            email_daily_limit: limit,
            held: 4,
            pending: 1,
            failed: 2,
            sent_today: 9,
          },
        ];
      if (sql.includes("SET status = 'held'")) return [[], 3];
      return [];
    };

    it('shows the mode, the limit, today and whether the server is able to send', async () => {
      const { service } = makeService(tenantRow('manual', 80));
      await expect(service.settings(gestor)).resolves.toEqual({
        mode: 'manual',
        dailyLimit: 80,
        maxDailyLimit: TENANT_MAX_DAILY_LIMIT,
        sentToday: 9,
        held: 4,
        pending: 1,
        failed: 2,
        sending: {
          configured: true,
          running: true,
          sender: 'Flui <noreply@exemplo.dev>',
        },
      });
    });

    it('auto → manual pauses right away: what was pending waits for the gestor', async () => {
      const { service, find } = makeService(tenantRow('auto', 100));
      await service.updateSettings({ mode: 'manual' }, gestor);
      expect(find('UPDATE tenants SET email_mode')[0][1]).toEqual([
        TENANT,
        'manual',
        100,
      ]);
      const [[holdSql, holdParams]] = find("SET status = 'held'");
      expect(holdSql).toContain("WHERE tenant_id = $1 AND status = 'pending'");
      expect(holdParams).toEqual([TENANT]);
      const [[, audit]] = find("'email_settings_updated'");
      expect(audit.slice(0, 4)).toEqual([
        TENANT,
        'g1',
        'Envio automático',
        'Aprovação do gestor',
      ]);
      expect(JSON.parse(audit[4] as string)).toEqual({
        before: { mode: 'auto', dailyLimit: 100 },
        after: { mode: 'manual', dailyLimit: 100 },
        heldNow: 3,
      });
    });

    it('manual → auto does not release what was held: turning it on fires nothing', async () => {
      const { service, queries, worker } = makeService(
        tenantRow('manual', 100),
      );
      await service.updateSettings({ mode: 'auto' }, gestor);
      const touched = queries.filter(([sql]) =>
        sql.includes('UPDATE message_outbox'),
      );
      expect(touched).toHaveLength(0);
      expect(worker.soon).not.toHaveBeenCalled();
    });

    it('raising the limit puts back what the old limit had postponed', async () => {
      const { service, find, worker } = makeService(tenantRow('auto', 50));
      await service.updateSettings({ dailyLimit: 120 }, gestor);
      const [[sql]] = find("last_error LIKE 'Limite diário da assessoria%'");
      expect(sql).toContain("WHERE tenant_id = $1 AND status = 'pending'");
      expect(worker.soon).toHaveBeenCalled();
      const [[, audit]] = find("'email_settings_updated'");
      // the mode did not change: no "de → para"
      expect(audit.slice(2, 4)).toEqual([null, null]);
    });

    it('nothing changed: nothing written, nothing logged', async () => {
      const { service, find } = makeService(tenantRow('manual', 100));
      await service.updateSettings({ mode: 'manual', dailyLimit: 100 }, gestor);
      expect(find('UPDATE tenants')).toHaveLength(0);
      expect(find('INSERT INTO audit_logs')).toHaveLength(0);
    });

    it('refuses an empty change and a limit above the maximum', async () => {
      const { service, queries } = makeService(tenantRow('manual', 100));
      await expect(service.updateSettings({}, gestor)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.updateSettings(
          { dailyLimit: TENANT_MAX_DAILY_LIMIT + 1 },
          gestor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(queries).toHaveLength(0);
    });
  });

  describe('list', () => {
    it('lists by situation with the client name, and the total of each situation', async () => {
      const created = new Date('2026-11-11T12:00:00Z');
      const { service, find } = makeService((sql) => {
        if (sql.includes('GROUP BY status'))
          return [
            { status: 'held', n: 2 },
            { status: 'sent', n: 7 },
          ];
        return [
          {
            id: 'm1',
            created_at: created,
            event_type: 'bank_analysis',
            recipient_role: 'cliente',
            recipient: 'helena@exemplo.dev',
            subject: 'Assunto',
            status: 'held',
            attempts: 0,
            last_error: null,
            sent_at: null,
            next_attempt_at: created,
            process_id: 'p1',
            has_content: true,
            client_name: 'Helena',
          },
        ];
      });
      const out = await service.list(gestor, { status: 'held', limit: 500 });
      expect(out.counts).toEqual({
        held: 2,
        pending: 0,
        sent: 7,
        failed: 0,
        cancelled: 0,
        expired: 0,
      });
      expect(out.items[0]).toMatchObject({
        id: 'm1',
        status: 'held',
        clientName: 'Helena',
        hasContent: true,
        // only meaningful while the message is still going to leave
        nextAttemptAt: null,
      });
      const [[sql, params]] = find('FROM message_outbox m');
      expect(sql).toContain('m.status = $2');
      // the join cannot bring a process or a person of another assessoria
      expect(sql).toContain('p.tenant_id = m.tenant_id');
      expect(sql).toContain('c.tenant_id = m.tenant_id');
      expect(params).toEqual([TENANT, 'held', 100, 0]);
    });
  });

  describe('direct sends (invite, password reset, e-mail test)', () => {
    const counts =
      (all: number, tenant: number, limit: number | null) => (sql: string) =>
        sql.includes('outbox:direct-gate')
          ? [{ all_today: all, tenant_today: tenant, daily_limit: limit }]
          : [];
    const ctx = { tenantId: TENANT, recipientRole: 'cliente' as const };

    it('the gate registered in the e-mail service is this daily limit', async () => {
      const { gate } = makeService(counts(0, 100, 100));
      await expect(gate()(ctx)).resolves.toMatch(
        /Limite diário da assessoria atingido \(100 e-mails\)/,
      );
    });

    it('within both limits: may leave', async () => {
      const { service, find } = makeService(counts(10, 5, 100));
      await expect(service.directRefusal(ctx)).resolves.toBeNull();
      expect(find('outbox:direct-gate')[0][1]).toEqual([TENANT]);
    });

    it('the server limit comes first, for any assessoria', async () => {
      const { service } = makeService(counts(250, 0, 100), {
        globalLimit: 250,
      });
      await expect(service.directRefusal(ctx)).resolves.toMatch(
        /Limite diário do servidor atingido \(250 e-mails\)/,
      );
    });

    it('an account without assessoria is held to the server limit only', async () => {
      const { service } = makeService(counts(3, 0, null));
      await expect(
        service.directRefusal({ tenantId: null, recipientRole: 'gestor' }),
      ).resolves.toBeNull();
    });

    const sent: DirectSend = {
      tenantId: TENANT,
      recipientRole: 'analista',
      actorId: 'g1',
      eventType: 'invite',
      to: 'ana@exemplo.dev',
      subject: 'Bem-vindo',
      ok: true,
      error: null,
    };

    it('each one is recorded for the gestor, without content (it carries an access link)', async () => {
      const { service, find } = makeService();
      await service.recordDirect(sent);
      const [[sql, params]] = find('INSERT INTO message_outbox');
      // html and text are stored empty
      expect(sql).toContain("VALUES ($1, $2, $3, $4, $5, '', ''");
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toEqual([
        TENANT,
        'invite',
        'analista',
        'ana@exemplo.dev',
        'Bem-vindo',
        'sent',
        null,
        'g1',
        'email_sent',
      ]);
    });

    it('a refused or failed one is recorded as failed, with the reason', async () => {
      const { service, find } = makeService();
      await service.recordDirect({
        ...sent,
        ok: false,
        error: 'Limite diário da assessoria atingido (100 e-mails)',
      });
      const [[, params]] = find('INSERT INTO message_outbox');
      expect(params.slice(5)).toEqual([
        'failed',
        'Limite diário da assessoria atingido (100 e-mails)',
        'g1',
        'email_failed',
      ]);
    });

    it('the listener registered in the e-mail service records the send', async () => {
      const { listener, find } = makeService();
      listener()(sent);
      await new Promise((r) => setImmediate(r));
      expect(find('INSERT INTO message_outbox')).toHaveLength(1);
    });

    it('a failure recording never reaches who sent the e-mail', async () => {
      const { service } = makeService(() => {
        throw new Error('db down');
      });
      await expect(service.recordDirect(sent)).resolves.toBeUndefined();
    });

    it('an account without assessoria (Super Admin) is not listed anywhere', async () => {
      const { service, queries } = makeService();
      await service.recordDirect({ ...sent, tenantId: null });
      expect(queries).toHaveLength(0);
    });
  });
});
