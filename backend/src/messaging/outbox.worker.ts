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

// Travas contra enxurrada de e-mails. O teto global fica abaixo da cota do
// provedor (Brevo gratuito: 300/dia); cada assessoria tem o próprio teto
// (tenants.email_daily_limit, que o gestor ajusta até TENANT_MAX_DAILY_LIMIT).
export const DEFAULT_GLOBAL_DAILY_LIMIT = 250;
export const TENANT_MAX_DAILY_LIMIT = 250;
// Mensagem que ficou na fila mais do que isto não sai mais sozinha (ex.: envio
// desligado por dias): vira 'expired' e o gestor decide se reenvia.
export const DEFAULT_MAX_AGE_HOURS = 48;

// O "dia" dos limites é o de Brasília.
const TODAY = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;

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

interface TenantQuota {
  tenant_id: string;
  daily_limit: number;
  sent_today: number;
  sent_today_all: number;
}

export function backoffSeconds(attempts: number): number {
  return BACKOFF_SECONDS[
    Math.min(Math.max(attempts, 1), BACKOFF_SECONDS.length) - 1
  ];
}

// Quem tem mensagem a enviar agora, o teto de cada assessoria e quanto já saiu
// hoje (da assessoria e de todas). 'held' (aguardando o gestor) não entra.
export const QUOTA_SQL = `/* outbox:quota */
  SELECT d.tenant_id,
         t.email_daily_limit AS daily_limit,
         (SELECT count(*) FROM message_outbox s
           WHERE s.tenant_id = d.tenant_id AND s.status = 'sent' AND s.sent_at >= ${TODAY})::int AS sent_today,
         (SELECT count(*) FROM message_outbox g
           WHERE g.status = 'sent' AND g.sent_at >= ${TODAY})::int AS sent_today_all
    FROM (SELECT DISTINCT tenant_id FROM message_outbox
           WHERE status = 'pending' AND next_attempt_at <= now()) d
    JOIN tenants t ON t.id = d.tenant_id
   ORDER BY d.tenant_id`;

// Claims due messages of one tenant atomically. SKIP LOCKED lets several API
// instances drain the same table without sending a message twice. TypeORM
// returns [rows, rowCount] for an UPDATE ... RETURNING on Postgres.
export const CLAIM_SQL = `
  UPDATE message_outbox m
     SET attempts = m.attempts + 1,
         next_attempt_at = now() + make_interval(secs => $2),
         updated_at = now()
   WHERE m.id IN (
           SELECT id FROM message_outbox
            WHERE status = 'pending' AND next_attempt_at <= now()
              AND tenant_id = $3
            ORDER BY created_at
            LIMIT $1
            FOR UPDATE SKIP LOCKED)
  RETURNING m.id, m.event_type, m.recipient, m.subject, m.html, m.text, m.attempts`;

// Teto do dia atingido: o que sobrou fica para amanhã, com o motivo à vista.
export const POSTPONE_SQL = `/* outbox:postpone */
  UPDATE message_outbox
     SET next_attempt_at = ${TODAY} + interval '1 day',
         last_error = $2,
         updated_at = now()
   WHERE tenant_id = $1 AND status = 'pending' AND next_attempt_at <= now()`;

// Fila velha não vira enxurrada: pendente há mais de $1 horas ou aguardando o
// gestor há mais de $3 dias vira 'expired', e isso fica no Log de Ações.
export const EXPIRE_SQL = `/* outbox:expire */
  WITH gone AS (
    UPDATE message_outbox
       SET status = 'expired', last_error = $2, updated_at = now()
     WHERE (status = 'pending' AND created_at < now() - make_interval(hours => $1))
        OR (status = 'held' AND created_at < now() - make_interval(days => $3))
    RETURNING id, tenant_id, process_id, event_type, recipient_role, subject)
  INSERT INTO audit_logs (tenant_id, process_id, action, metadata)
  SELECT tenant_id, process_id, 'email_expired',
         jsonb_build_object('messageId', id, 'eventType', event_type,
                            'recipientRole', recipient_role, 'subject', subject)
    FROM gone`;

// Cada disparo fica no Log de Ações da assessoria (sem o endereço: o processo
// e o papel do destinatário bastam para o gestor saber quem recebeu).
export const AUDIT_SQL = `/* outbox:audit */
  INSERT INTO audit_logs (tenant_id, process_id, action, metadata)
  SELECT tenant_id, process_id, $2::varchar,
         jsonb_build_object('messageId', id, 'eventType', event_type,
                            'recipientRole', recipient_role, 'subject', subject)
           || CASE WHEN $3::text IS NULL THEN '{}'::jsonb
                   ELSE jsonb_build_object('error', $3::text) END
    FROM message_outbox WHERE id = $1`;

/**
 * Sends what MessagingService queued (BE-09_v2): polls `message_outbox`, sends
 * each message by SMTP and retries failures with backoff until MAX_ATTEMPTS.
 * Only 'pending' messages leave: in a tenant on manual mode they are queued as
 * 'held' and wait for the gestor. Each tenant has a daily cap and the server a
 * global one; what is left waits for the next day. Sent, failed, cancelled and
 * expired messages are deleted after MESSAGE_RETENTION_DAYS (BE-16_v2: they
 * carry personal data) — the Log de Ações keeps the record of each dispatch.
 */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly pollMs: number;
  private readonly retentionDays: number;
  private readonly globalDailyLimit: number;
  private readonly maxAgeHours: number;
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
    this.globalDailyLimit = positive(
      config.get('MESSAGING_DAILY_LIMIT'),
      DEFAULT_GLOBAL_DAILY_LIMIT,
    );
    this.maxAgeHours = positive(
      config.get('MESSAGE_MAX_AGE_HOURS'),
      DEFAULT_MAX_AGE_HOURS,
    );
    this.enabled = config.get<string>('MESSAGING_WORKER', 'on') !== 'off';
  }

  /** Teto de e-mails por dia somando todas as assessorias. */
  get dailyLimit(): number {
    return this.globalDailyLimit;
  }

  /** O envio automático está de pé (worker ligado e SMTP configurado)? */
  get isRunning(): boolean {
    return !!this.interval;
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
      `Mensageria ativa: fila message_outbox, verificação a cada ${this.pollMs} ms; teto global de ${this.globalDailyLimit} e-mails por dia`,
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
      await this.dataSource.query(EXPIRE_SQL, [
        this.maxAgeHours,
        `Não enviada: ficou mais de ${this.maxAgeHours} h na fila`,
        this.retentionDays,
      ]);
      const tenants = await this.dataSource.query<TenantQuota[]>(QUOTA_SQL);
      let globalLeft =
        this.globalDailyLimit - Number(tenants[0]?.sent_today_all ?? 0);
      for (const tenant of tenants) {
        let left = Math.min(
          Number(tenant.daily_limit) - Number(tenant.sent_today),
          globalLeft,
        );
        for (;;) {
          if (left <= 0) {
            await this.postpone(tenant, globalLeft <= 0);
            break;
          }
          const take = Math.min(BATCH, left);
          const [rows] = await this.dataSource.query<[OutboxRow[], number]>(
            CLAIM_SQL,
            [take, LEASE_SECONDS, tenant.tenant_id],
          );
          for (const row of rows) {
            const outcome = await this.deliver(row);
            result[outcome]++;
            if (outcome === 'sent') {
              left--;
              globalLeft--;
            }
          }
          if (rows.length < take) break; // nothing else due for this tenant
        }
      }
      await this.purge();
    } catch (err) {
      // e.g. database unavailable: the next poll tries again
      this.logger.error(`Mensageria: falha ao ler a fila: ${errorText(err)}`);
    }
    return result;
  }

  // O teto do dia foi atingido: o resto fica para amanhã (e aparece assim na
  // tela de E-mails do gestor).
  private async postpone(tenant: TenantQuota, global: boolean): Promise<void> {
    const reason = global
      ? `Limite diário do servidor atingido (${this.globalDailyLimit} e-mails); o envio continua amanhã`
      : `Limite diário da assessoria atingido (${tenant.daily_limit} e-mails); o envio continua amanhã`;
    await this.dataSource.query(POSTPONE_SQL, [tenant.tenant_id, reason]);
    this.logger.warn(
      `Mensageria: ${global ? 'teto global' : `teto da assessoria ${tenant.tenant_id}`} atingido; restante adiado para amanhã`,
    );
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
      await this.audit(row.id, 'email_sent', null);
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
          WHERE id = $1 AND status = 'pending'`,
        [
          row.id,
          final ? 'failed' : 'pending',
          backoffSeconds(row.attempts),
          error,
        ],
      );
      // The recipient stays out of the log (personal data); the id finds it.
      const what = `Mensagem ${row.id} (${row.event_type}), tentativa ${row.attempts}/${MAX_ATTEMPTS}`;
      if (final) {
        this.logger.error(`${what}: desistindo. ${error}`);
        await this.audit(row.id, 'email_failed', error);
      } else
        this.logger.warn(
          `${what}: falhou, nova tentativa em ${backoffSeconds(row.attempts)} s. ${error}`,
        );
      return final ? 'failed' : 'retried';
    }
  }

  // The message has already left (or was given up): a failure writing the log
  // entry must not change that, nor make it be sent again.
  private async audit(
    id: string,
    action: 'email_sent' | 'email_failed',
    error: string | null,
  ): Promise<void> {
    try {
      await this.dataSource.query(AUDIT_SQL, [id, action, error]);
    } catch (err) {
      this.logger.warn(
        `Mensagem ${id}: ${action} não registrado no Log de Ações. ${errorText(err)}`,
      );
    }
  }

  private async purge(now = Date.now()): Promise<void> {
    if (now - this.lastPurge < PURGE_EVERY_MS) return;
    this.lastPurge = now;
    await this.dataSource.query(
      `DELETE FROM message_outbox
        WHERE status IN ('sent', 'failed', 'cancelled', 'expired')
          AND created_at < now() - make_interval(days => $1)`,
      [this.retentionDays],
    );
  }
}

function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
