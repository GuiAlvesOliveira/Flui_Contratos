import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  BACKOFF_SECONDS,
  backoffSeconds,
  CLAIM_SQL,
  DEFAULT_GLOBAL_DAILY_LIMIT,
  EXPIRE_SQL,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  OutboxWorker,
  QUOTA_SQL,
  type OutboxRow,
} from './outbox.worker';

const TENANT = 't1';

const row = (id: string, attempts = 1): OutboxRow => ({
  id,
  event_type: 'bank_analysis',
  recipient: `${id}@exemplo.dev`,
  subject: `assunto ${id}`,
  html: '<p>oi</p>',
  text: 'oi',
  attempts,
});

interface Quota {
  tenant_id: string;
  daily_limit: number;
  sent_today: number;
  sent_today_all: number;
}

// `batches` is what each claim returns, in order (for any tenant). `quota` is
// what the assessorias with due messages look like when the run starts.
function makeWorker(
  batches: OutboxRow[][],
  opts: {
    configured?: boolean;
    env?: Record<string, string>;
    quota?: Quota[];
  } = {},
) {
  const updates: unknown[][] = [];
  const claims: unknown[][] = [];
  const postponed: unknown[][] = [];
  const audits: unknown[][] = [];
  const quota = opts.quota ?? [
    { tenant_id: TENANT, daily_limit: 100, sent_today: 0, sent_today_all: 0 },
  ];
  const dataSource = {
    query: jest.fn((sql: string, params: unknown[] = []): Promise<unknown> => {
      if (sql.includes('outbox:quota')) return Promise.resolve(quota);
      if (sql.includes('outbox:expire')) return Promise.resolve([]);
      if (sql.includes('outbox:postpone')) {
        postponed.push(params);
        return Promise.resolve([[], 0]);
      }
      if (sql.includes('outbox:audit')) {
        audits.push(params);
        return Promise.resolve([]);
      }
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        claims.push(params);
        return Promise.resolve([batches.shift() ?? [], 0]);
      }
      if (sql.includes('UPDATE message_outbox')) updates.push([sql, ...params]);
      return Promise.resolve([]);
    }),
  };
  const email = {
    isConfigured: opts.configured ?? true,
    sendOrThrow: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: (key: string, def?: unknown) => opts.env?.[key] ?? def,
  } as unknown as ConfigService;
  const worker = new OutboxWorker(
    dataSource as unknown as DataSource,
    email as never,
    config,
  );
  return { worker, dataSource, email, updates, claims, postponed, audits };
}

describe('OutboxWorker (BE-09_v2)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('claims due messages with SKIP LOCKED and a lease, so instances never send twice', async () => {
    const { worker, claims } = makeWorker([[]]);
    await worker.drain();
    expect(CLAIM_SQL).toContain(
      "status = 'pending' AND next_attempt_at <= now()",
    );
    expect(CLAIM_SQL).toContain('FOR UPDATE SKIP LOCKED');
    expect(CLAIM_SQL).toContain('attempts = m.attempts + 1');
    // one assessoria at a time, so each one is held to its own daily limit
    expect(CLAIM_SQL).toContain('AND tenant_id = $3');
    expect(claims).toEqual([[20, LEASE_SECONDS, TENANT]]);
  });

  it("only 'pending' leaves: messages waiting for the gestor ('held') are never claimed", () => {
    for (const sql of [CLAIM_SQL, QUOTA_SQL]) {
      expect(sql).toContain("status = 'pending'");
      expect(sql).not.toContain('held');
    }
  });

  it('no assessoria with a due message: nothing is claimed', async () => {
    const { worker, claims, email } = makeWorker([[row('a')]], { quota: [] });
    await expect(worker.drain()).resolves.toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
    expect(claims).toHaveLength(0);
    expect(email.sendOrThrow).not.toHaveBeenCalled();
  });

  it('sends each message (HTML + text) and marks it as sent', async () => {
    const { worker, email, updates } = makeWorker([[row('a'), row('b')]]);
    await expect(worker.drain()).resolves.toEqual({
      sent: 2,
      retried: 0,
      failed: 0,
    });
    expect(email.sendOrThrow).toHaveBeenCalledWith(
      'a@exemplo.dev',
      'assunto a',
      '<p>oi</p>',
      'oi',
    );
    expect(
      updates.map((u) => [String(u[0]).includes("status = 'sent'"), u[1]]),
    ).toEqual([
      [true, 'a'],
      [true, 'b'],
    ]);
  });

  it('a failed send stays pending, with backoff and the error saved', async () => {
    const { worker, email, updates, audits } = makeWorker([[row('a', 2)]]);
    email.sendOrThrow.mockRejectedValueOnce(new Error('421 try again later'));
    await expect(worker.drain()).resolves.toEqual({
      sent: 0,
      retried: 1,
      failed: 0,
    });
    expect(updates[0].slice(1)).toEqual([
      'a',
      'pending',
      BACKOFF_SECONDS[1],
      '421 try again later',
    ]);
    // a message the gestor cancelled or paused meanwhile is not put back
    expect(String(updates[0][0])).toContain(
      "WHERE id = $1 AND status = 'pending'",
    );
    // a retry is not a dispatch yet: nothing goes to the Log de Ações
    expect(audits).toHaveLength(0);
  });

  it('every dispatch is recorded in the Log de Ações (sent, and failed for good)', async () => {
    const { worker, email, audits } = makeWorker([
      [row('a'), row('b', MAX_ATTEMPTS)],
    ]);
    email.sendOrThrow
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('550 mailbox unavailable'));
    await worker.drain();
    expect(audits).toEqual([
      ['a', 'email_sent', null],
      ['b', 'email_failed', '550 mailbox unavailable'],
    ]);
  });

  it('a failure writing the Log de Ações does not make a sent message go out again', async () => {
    const { worker, dataSource, updates } = makeWorker([[row('a')]]);
    const query = dataSource.query.getMockImplementation()!;
    dataSource.query.mockImplementation((sql: string, params?: unknown[]) =>
      sql.includes('outbox:audit')
        ? Promise.reject(new Error('audit down'))
        : query(sql, params),
    );
    await expect(worker.drain()).resolves.toEqual({
      sent: 1,
      retried: 0,
      failed: 0,
    });
    expect(updates).toHaveLength(1);
    expect(String(updates[0][0])).toContain("status = 'sent'");
  });

  it(`gives up after ${MAX_ATTEMPTS} attempts (status failed)`, async () => {
    const { worker, email, updates } = makeWorker([[row('a', MAX_ATTEMPTS)]]);
    email.sendOrThrow.mockRejectedValueOnce(
      new Error('550 mailbox unavailable'),
    );
    await expect(worker.drain()).resolves.toEqual({
      sent: 0,
      retried: 0,
      failed: 1,
    });
    expect(updates[0][2]).toBe('failed');
  });

  it('one bad message does not stop the others', async () => {
    const { worker, email } = makeWorker([[row('a'), row('b'), row('c')]]);
    email.sendOrThrow.mockRejectedValueOnce(new Error('boom'));
    await expect(worker.drain()).resolves.toEqual({
      sent: 2,
      retried: 1,
      failed: 0,
    });
  });

  it('keeps claiming while full batches come back', async () => {
    const full = Array.from({ length: 20 }, (_, i) => row(`m${i}`));
    const { worker, claims } = makeWorker([full, [row('last')]]);
    await expect(worker.drain()).resolves.toMatchObject({ sent: 21 });
    expect(claims).toHaveLength(2);
  });

  describe('daily limits (no flood of e-mails)', () => {
    const many = (n: number, prefix = 'm') =>
      Array.from({ length: n }, (_, i) => row(`${prefix}${i}`));

    it('never claims more than what is left of the assessoria limit, and postpones the rest', async () => {
      const { worker, email, claims, postponed } = makeWorker(
        [many(3), many(20, 'x')],
        {
          quota: [
            {
              tenant_id: TENANT,
              daily_limit: 10,
              sent_today: 7,
              sent_today_all: 7,
            },
          ],
        },
      );
      await expect(worker.drain()).resolves.toMatchObject({ sent: 3 });
      expect(claims).toEqual([[3, LEASE_SECONDS, TENANT]]);
      expect(email.sendOrThrow).toHaveBeenCalledTimes(3);
      expect(postponed).toHaveLength(1);
      expect(postponed[0][0]).toBe(TENANT);
      expect(postponed[0][1]).toMatch(
        /Limite diário da assessoria atingido \(10 e-mails\)/,
      );
    });

    it('limit already reached: nothing is sent', async () => {
      const { worker, email, claims, postponed } = makeWorker([many(5)], {
        quota: [
          {
            tenant_id: TENANT,
            daily_limit: 10,
            sent_today: 10,
            sent_today_all: 10,
          },
        ],
      });
      await expect(worker.drain()).resolves.toMatchObject({ sent: 0 });
      expect(claims).toHaveLength(0);
      expect(email.sendOrThrow).not.toHaveBeenCalled();
      expect(postponed).toHaveLength(1);
    });

    it('the server limit holds every assessoria together', async () => {
      const { worker, email, claims, postponed } = makeWorker(
        [many(2), many(20, 'x')],
        {
          env: { MESSAGING_DAILY_LIMIT: '50' },
          quota: [
            {
              tenant_id: 't1',
              daily_limit: 100,
              sent_today: 0,
              sent_today_all: 48,
            },
            {
              tenant_id: 't2',
              daily_limit: 100,
              sent_today: 0,
              sent_today_all: 48,
            },
          ],
        },
      );
      await expect(worker.drain()).resolves.toMatchObject({ sent: 2 });
      // t1 takes the 2 that were left; t2 is not even claimed
      expect(claims).toEqual([[2, LEASE_SECONDS, 't1']]);
      expect(email.sendOrThrow).toHaveBeenCalledTimes(2);
      expect(postponed.map((p) => p[0])).toEqual(['t1', 't2']);
      expect(postponed[1][1]).toMatch(
        /Limite diário do servidor atingido \(50 e-mails\)/,
      );
    });

    it('one assessoria at its limit does not stop the others', async () => {
      const { worker, claims } = makeWorker([many(4)], {
        quota: [
          { tenant_id: 't1', daily_limit: 5, sent_today: 5, sent_today_all: 5 },
          {
            tenant_id: 't2',
            daily_limit: 100,
            sent_today: 0,
            sent_today_all: 5,
          },
        ],
      });
      await expect(worker.drain()).resolves.toMatchObject({ sent: 4 });
      expect(claims).toEqual([[20, LEASE_SECONDS, 't2']]);
    });

    it('a send that failed does not use up the limit', async () => {
      const { worker, email, claims } = makeWorker([many(2), many(1, 'x')], {
        quota: [
          {
            tenant_id: TENANT,
            daily_limit: 2,
            sent_today: 0,
            sent_today_all: 0,
          },
        ],
      });
      email.sendOrThrow.mockRejectedValueOnce(new Error('boom'));
      await expect(worker.drain()).resolves.toEqual({
        sent: 2,
        retried: 1,
        failed: 0,
      });
      expect(claims).toEqual([
        [2, LEASE_SECONDS, TENANT],
        [1, LEASE_SECONDS, TENANT],
      ]);
    });

    it(`the server limit defaults to ${DEFAULT_GLOBAL_DAILY_LIMIT} and ignores a bad setting`, () => {
      expect(makeWorker([]).worker.dailyLimit).toBe(DEFAULT_GLOBAL_DAILY_LIMIT);
      for (const bad of ['0', '-5', 'abc']) {
        expect(
          makeWorker([], { env: { MESSAGING_DAILY_LIMIT: bad } }).worker
            .dailyLimit,
        ).toBe(DEFAULT_GLOBAL_DAILY_LIMIT);
      }
    });

    it('an old queue does not become a flood: stale messages expire instead of leaving', async () => {
      const { worker, dataSource } = makeWorker([[]], {
        env: { MESSAGE_MAX_AGE_HOURS: '12', MESSAGE_RETENTION_DAYS: '15' },
      });
      await worker.drain();
      const expire = dataSource.query.mock.calls.find(([s]) =>
        String(s).includes('outbox:expire'),
      );
      expect(expire?.[1]).toEqual([
        12,
        'Não enviada: ficou mais de 12 h na fila',
        15,
      ]);
      // runs before anything is claimed
      expect(dataSource.query.mock.calls[0][0]).toBe(EXPIRE_SQL);
      expect(EXPIRE_SQL).toContain("SET status = 'expired'");
      expect(EXPIRE_SQL).toContain("'email_expired'");
    });
  });

  it('concurrent drains share a single run', async () => {
    const { worker, claims } = makeWorker([[row('a')]]);
    const [r1, r2] = await Promise.all([worker.drain(), worker.drain()]);
    expect(r1).toBe(r2);
    // the second call schedules one more pass after the first one finishes
    await new Promise((r) => setImmediate(r));
    expect(claims.length).toBeGreaterThanOrEqual(1);
  });

  it('a database error is logged and the next poll tries again', async () => {
    const { worker, dataSource } = makeWorker([]);
    const logError = jest.spyOn(Logger.prototype, 'error');
    dataSource.query.mockRejectedValueOnce(new Error('connection refused'));
    await expect(worker.drain()).resolves.toEqual({
      sent: 0,
      retried: 0,
      failed: 0,
    });
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('connection refused'),
    );
  });

  it('BE-16_v2: deletes finished messages older than the retention (personal data)', async () => {
    const { worker, dataSource } = makeWorker([[]], {
      env: { MESSAGE_RETENTION_DAYS: '15' },
    });
    await worker.drain();
    const purge = dataSource.query.mock.calls.find(([s]) =>
      String(s).includes('DELETE FROM message_outbox'),
    );
    expect(purge?.[0]).toContain(
      "status IN ('sent', 'failed', 'cancelled', 'expired')",
    );
    expect(purge?.[1]).toEqual([15]);
  });

  it('without SMTP the worker does not start: messages wait in the queue', () => {
    const { worker, dataSource } = makeWorker([], { configured: false });
    worker.onApplicationBootstrap();
    worker.soon();
    expect(dataSource.query).not.toHaveBeenCalled();
    worker.onModuleDestroy();
  });

  it('MESSAGING_WORKER=off keeps the worker off', () => {
    const { worker, dataSource } = makeWorker([], {
      env: { MESSAGING_WORKER: 'off' },
    });
    worker.onApplicationBootstrap();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('backoff grows and is capped at the last step', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(backoffSeconds)).toEqual([
      30, 120, 600, 1800, 7200, 7200, 7200,
    ]);
  });
});
