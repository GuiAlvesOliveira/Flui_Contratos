import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { EmailService } from '../email/email.service';

export const MAX_ATTEMPTS = 6;
// Wait after the 1st, 2nd... failed attempt: 30 s, 2 min, 10 min, 30 min, 2 h.
export const BACKOFF_SECONDS = [30, 120, 600, 1800, 7200];
// A claimed message is invisible to other instances for this long; if the
// instance dies mid-send, the message becomes due again afterwards.
export const LEASE_SECONDS = 600;
const BATCH = 20;
const PURGE_EVERY_MS = 60 * 60 * 1000;

export interface OutboxRow {
  id: string;
  event_type: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  attempts: number;
}

export interface DrainResult {
  sent: number;
  retried: number;
  failed: number;
}

export function backoffSeconds(attempts: number): number {
  return BACKOFF_SECONDS[
    Math.min(Math.max(attempts, 1), BACKOFF_SECONDS.length) - 1
  ];
}

// Claims due messages atomically. SKIP LOCKED lets several API instances drain
// the same table without sending a message twice. TypeORM returns
// [rows, rowCount] for an UPDATE ... RETURNING on Postgres.
export const CLAIM_SQL = `
  UPDATE message_outbox m
     SET attempts = m.attempts + 1,
         next_attempt_at = now() + make_interval(secs => $2),
         updated_at = now()
   WHERE m.id IN (
           SELECT id FROM message_outbox
            WHERE status = 'pending' AND next_attempt_at <= now()
            ORDER BY created_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED)
  RETURNING m.id, m.event_type, m.recipient, m.subject, m.html, m.text, m.attempts`;

/**
 * Sends what MessagingService queued (BE-09_v2): polls `message_outbox`, sends
 * each message by SMTP and retries failures with backoff until MAX_ATTEMPTS.
 * Sent and failed messages are deleted after MESSAGE_RETENTION_DAYS (BE-16_v2:
 * they carry personal data).
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly pollMs: number;
  private readonly retentionDays: number;
  private readonly enabled: boolean;
  private interval?: NodeJS.Timeout;
  private soonTimer?: NodeJS.Timeout;
  private draining: Promise<DrainResult> | null = null;
  private again = false;
  private lastPurge = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.pollMs = Number(config.get('MESSAGING_POLL_MS', 5000));
    this.retentionDays = Number(config.get('MESSAGE_RETENTION_DAYS', 30));
    this.enabled = config.get<string>('MESSAGING_WORKER', 'on') !== 'off';
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.logger.log('Mensageria: worker desligado (MESSAGING_WORKER=off)');
      return;
    }
    if (!this.email.isConfigured) {
      this.logger.warn(
        'Mensageria: SMTP não configurado; as mensagens ficam na fila (message_outbox) até o envio ser configurado',
      );
      return;
    }
    this.interval = setInterval(() => void this.drain(), this.pollMs);
    this.interval.unref();
    this.logger.log(
      `Mensageria ativa: fila message_outbox, verificação a cada ${this.pollMs} ms`,
    );
    void this.drain();
  }

  onModuleDestroy(): void {
    clearInterval(this.interval);
    clearTimeout(this.soonTimer);
    this.interval = undefined;
  }

  // Called after a message is queued: drain shortly instead of at the next poll.
  soon(delayMs = 300): void {
    if (!this.interval || this.soonTimer) return;
    this.soonTimer = setTimeout(() => {
      this.soonTimer = undefined;
      void this.drain();
    }, delayMs);
    this.soonTimer.unref();
  }

  /** Sends every due message. Concurrent calls share one run. */
  drain(): Promise<DrainResult> {
    if (this.draining) {
      this.again = true;
      return this.draining;
    }
    this.draining = this.run().finally(() => {
      this.draining = null;
      if (this.again) {
        this.again = false;
        void this.drain();
      }
    });
    return this.draining;
  }

  private async run(): Promise<DrainResult> {
    const result: DrainResult = { sent: 0, retried: 0, failed: 0 };
    try {
      for (;;) {
        const [rows] = await this.dataSource.query<[OutboxRow[], number]>(
          CLAIM_SQL,
          [BATCH, LEASE_SECONDS],
        );
        for (const row of rows) {
          result[await this.deliver(row)]++;
        }
        if (rows.length < BATCH) break;
      }
      await this.purge();
    } catch (err) {
      // e.g. database unavailable: the next poll tries again
      this.logger.error(`Mensageria: falha ao ler a fila: ${errorText(err)}`);
    }
    return result;
  }

  private async deliver(row: OutboxRow): Promise<keyof DrainResult> {
    try {
      await this.email.sendOrThrow(
        row.recipient,
        row.subject,
        row.html,
        row.text,
      );
      await this.dataSource.query(
        `UPDATE message_outbox
            SET status = 'sent', sent_at = now(), last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id],
      );
      return 'sent';
    } catch (err) {
      const final = row.attempts >= MAX_ATTEMPTS;
      const error = errorText(err).slice(0, 500);
      await this.dataSource.query(
        `UPDATE message_outbox
            SET status = $2,
                next_attempt_at = now() + make_interval(secs => $3),
                last_error = $4,
                updated_at = now()
          WHERE id = $1`,
        [
          row.id,
          final ? 'failed' : 'pending',
          backoffSeconds(row.attempts),
          error,
        ],
      );
      // The recipient stays out of the log (personal data); the id finds it.
      const what = `Mensagem ${row.id} (${row.event_type}), tentativa ${row.attempts}/${MAX_ATTEMPTS}`;
      if (final) this.logger.error(`${what}: desistindo. ${error}`);
      else
        this.logger.warn(
          `${what}: falhou, nova tentativa em ${backoffSeconds(row.attempts)} s. ${error}`,
        );
      return final ? 'failed' : 'retried';
    }
  }

  private async purge(now = Date.now()): Promise<void> {
    if (now - this.lastPurge < PURGE_EVERY_MS) return;
    this.lastPurge = now;
    await this.dataSource.query(
      `DELETE FROM message_outbox
        WHERE status IN ('sent', 'failed')
          AND created_at < now() - make_interval(days => $1)`,
      [this.retentionDays],
    );
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
