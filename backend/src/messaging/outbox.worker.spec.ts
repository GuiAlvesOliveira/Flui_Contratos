import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import {
  BACKOFF_SECONDS,
  backoffSeconds,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  OutboxWorker,
  type OutboxRow,
} from './outbox.worker';

const row = (id: string, attempts = 1): OutboxRow => ({
  id,
  event_type: 'bank_analysis',
  recipient: `${id}@exemplo.dev`,
  subject: `assunto ${id}`,
  html: '<p>oi</p>',
  text: 'oi',
  attempts,
});

function makeWorker(
  batches: OutboxRow[][],
  opts: { configured?: boolean; env?: Record<string, string> } = {},
) {
  const updates: unknown[][] = [];
  const dataSource = {
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
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
  return { worker, dataSource, email, updates };
}

describe('OutboxWorker (BE-09_v2)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('claims due messages with SKIP LOCKED and a lease, so instances never send twice', async () => {
    const { worker, dataSource } = makeWorker([[]]);
    await worker.drain();
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain("status = 'pending' AND next_attempt_at <= now()");
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('attempts = m.attempts + 1');
    expect(params).toEqual([20, LEASE_SECONDS]);
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
    const { worker, email, updates } = makeWorker([[row('a', 2)]]);
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
    const { worker, dataSource } = makeWorker([full, [row('last')]]);
    await expect(worker.drain()).resolves.toMatchObject({ sent: 21 });
    const claims = dataSource.query.mock.calls.filter(([s]) =>
      String(s).includes('SKIP LOCKED'),
    );
    expect(claims).toHaveLength(2);
  });

  it('concurrent drains share a single run', async () => {
    const { worker, dataSource } = makeWorker([[row('a')]]);
    const [r1, r2] = await Promise.all([worker.drain(), worker.drain()]);
    expect(r1).toBe(r2);
    // the second call schedules one more pass after the first one finishes
    await new Promise((r) => setImmediate(r));
    const claims = dataSource.query.mock.calls.filter(([s]) =>
      String(s).includes('SKIP LOCKED'),
    );
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

  it('BE-16_v2: deletes sent/failed messages older than the retention (personal data)', async () => {
    const { worker, dataSource } = makeWorker([[]], {
      env: { MESSAGE_RETENTION_DAYS: '15' },
    });
    await worker.drain();
    const purge = dataSource.query.mock.calls.find(([s]) =>
      String(s).includes('DELETE FROM message_outbox'),
    );
    expect(purge?.[0]).toContain("status IN ('sent', 'failed')");
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
