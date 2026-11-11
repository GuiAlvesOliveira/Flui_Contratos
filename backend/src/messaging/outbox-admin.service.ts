import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import {
  DirectSend,
  DirectSendContext,
  EmailService,
} from '../email/email.service';
import { OutboxWorker, TENANT_MAX_DAILY_LIMIT } from './outbox.worker';

export type EmailMode = 'manual' | 'auto';
export const OUTBOX_STATUSES = [
  'held',
  'pending',
  'sent',
  'failed',
  'cancelled',
  'expired',
] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

const MODE_LABELS: Record<EmailMode, string> = {
  manual: 'Aprovação do gestor',
  auto: 'Envio automático',
};

// O "dia" dos limites é o de Brasília (o mesmo do worker).
const TODAY = `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`;

export interface MessagingSettings {
  mode: EmailMode;
  dailyLimit: number;
  maxDailyLimit: number;
  sentToday: number;
  held: number;
  pending: number;
  failed: number;
  // o servidor consegue enviar agora? (SMTP configurado e worker ligado)
  sending: { configured: boolean; running: boolean; sender: string };
}

export interface OutboxItem {
  id: string;
  createdAt: Date;
  eventType: string;
  recipientRole: string;
  recipient: string;
  subject: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  nextAttemptAt: Date | null;
  processId: string | null;
  clientName: string | null;
  // convites e redefinições de senha não guardam o conteúdo (têm link de acesso)
  hasContent: boolean;
}

interface SettingsRow {
  email_mode: EmailMode;
  email_daily_limit: number;
  held: number;
  pending: number;
  failed: number;
  sent_today: number;
}

type Selection = { ids?: string[]; all?: boolean };

/**
 * O envio de e-mails sob controle do gestor: o modo da assessoria (cada
 * mensagem espera a liberação dele, ou sai sozinha), o teto diário, a lista de
 * tudo o que foi enfileirado e o que fazer com cada mensagem (liberar,
 * cancelar, reenviar). Tudo sempre dentro da assessoria de quem chama (RN-01),
 * e cada decisão fica no Log de Ações (RN-07).
 */
@Injectable()
export class OutboxAdminService {
  private readonly logger = new Logger(OutboxAdminService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
    private readonly worker: OutboxWorker,
  ) {
    // Convite e redefinição de senha não passam pela fila; ficam registrados
    // aqui e contam nos mesmos limites diários (um CSV de usuários ou pedidos
    // repetidos de senha não viram enxurrada).
    this.email.onDirectSend((sent) => void this.recordDirect(sent));
    this.email.setDirectGate((ctx) => this.directRefusal(ctx));
  }

  // Um envio direto pode sair agora? Devolve o motivo da recusa, ou null.
  async directRefusal(ctx: DirectSendContext): Promise<string | null> {
    const [row] = await this.dataSource.query<
      { all_today: number; tenant_today: number; daily_limit: number | null }[]
    >(
      `/* outbox:direct-gate */
       SELECT (SELECT count(*) FROM message_outbox
                WHERE status = 'sent' AND sent_at >= ${TODAY})::int AS all_today,
              (SELECT count(*) FROM message_outbox
                WHERE tenant_id = $1::uuid AND status = 'sent' AND sent_at >= ${TODAY})::int AS tenant_today,
              (SELECT email_daily_limit FROM tenants WHERE id = $1::uuid) AS daily_limit`,
      [ctx.tenantId],
    );
    if (!row) return null;
    if (row.all_today >= this.worker.dailyLimit) {
      return `Limite diário do servidor atingido (${this.worker.dailyLimit} e-mails); tente de novo amanhã`;
    }
    if (row.daily_limit !== null && row.tenant_today >= row.daily_limit) {
      return `Limite diário da assessoria atingido (${row.daily_limit} e-mails); aumente o limite na tela de E-mails ou tente de novo amanhã`;
    }
    return null;
  }

  async settings(caller: RequestUserFull): Promise<MessagingSettings> {
    const [row] = await this.dataSource.query<SettingsRow[]>(
      `SELECT t.email_mode, t.email_daily_limit,
              (SELECT count(*) FROM message_outbox m WHERE m.tenant_id = t.id AND m.status = 'held')::int AS held,
              (SELECT count(*) FROM message_outbox m WHERE m.tenant_id = t.id AND m.status = 'pending')::int AS pending,
              (SELECT count(*) FROM message_outbox m WHERE m.tenant_id = t.id AND m.status = 'failed')::int AS failed,
              (SELECT count(*) FROM message_outbox m WHERE m.tenant_id = t.id AND m.status = 'sent'
                  AND m.sent_at >= ${TODAY})::int AS sent_today
         FROM tenants t WHERE t.id = $1`,
      [tenantOf(caller)],
    );
    if (!row) throw new NotFoundException('Assessoria não encontrada');
    return {
      mode: row.email_mode,
      dailyLimit: row.email_daily_limit,
      maxDailyLimit: TENANT_MAX_DAILY_LIMIT,
      sentToday: row.sent_today,
      held: row.held,
      pending: row.pending,
      failed: row.failed,
      sending: {
        configured: this.email.isConfigured,
        running: this.worker.isRunning,
        sender: this.email.sender,
      },
    };
  }

  async updateSettings(
    dto: { mode?: EmailMode; dailyLimit?: number },
    caller: RequestUserFull,
  ): Promise<MessagingSettings> {
    const tenantId = tenantOf(caller);
    if (dto.mode === undefined && dto.dailyLimit === undefined) {
      throw new BadRequestException(
        'Informe o modo de envio ou o limite diário',
      );
    }
    if (
      dto.dailyLimit !== undefined &&
      dto.dailyLimit > TENANT_MAX_DAILY_LIMIT
    ) {
      throw new BadRequestException(
        `O limite diário pode ser de no máximo ${TENANT_MAX_DAILY_LIMIT} e-mails`,
      );
    }
    let wake = false;
    await this.dataSource.transaction(async (manager) => {
      const [before] = await manager.query<
        { email_mode: EmailMode; email_daily_limit: number }[]
      >(
        `SELECT email_mode, email_daily_limit FROM tenants WHERE id = $1 FOR UPDATE`,
        [tenantId],
      );
      if (!before) throw new NotFoundException('Assessoria não encontrada');
      const mode = dto.mode ?? before.email_mode;
      const dailyLimit = dto.dailyLimit ?? before.email_daily_limit;
      if (mode === before.email_mode && dailyLimit === before.email_daily_limit)
        return;

      await manager.query(
        `UPDATE tenants SET email_mode = $2, email_daily_limit = $3 WHERE id = $1`,
        [tenantId, mode, dailyLimit],
      );
      let heldNow = 0;
      if (mode === 'manual' && before.email_mode !== 'manual') {
        // Pausar vale já: o que ainda não saiu passa a esperar o gestor.
        heldNow = affected(
          await manager.query(
            `UPDATE message_outbox SET status = 'held', updated_at = now()
              WHERE tenant_id = $1 AND status = 'pending'`,
            [tenantId],
          ),
        );
      }
      if (dailyLimit > before.email_daily_limit) {
        // O que tinha ficado para amanhã por causa do teto antigo volta para a fila.
        await manager.query(
          `UPDATE message_outbox
              SET next_attempt_at = now(), last_error = NULL, updated_at = now()
            WHERE tenant_id = $1 AND status = 'pending'
              AND last_error LIKE 'Limite diário da assessoria%'`,
          [tenantId],
        );
        wake = true;
      }
      await manager.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, action, from_state, to_state, metadata)
         VALUES ($1, $2, 'email_settings_updated', $3, $4, $5::jsonb)`,
        [
          tenantId,
          caller.userId,
          mode !== before.email_mode ? MODE_LABELS[before.email_mode] : null,
          mode !== before.email_mode ? MODE_LABELS[mode] : null,
          JSON.stringify({
            before: {
              mode: before.email_mode,
              dailyLimit: before.email_daily_limit,
            },
            after: { mode, dailyLimit },
            heldNow,
          }),
        ],
      );
    });
    if (wake) this.worker.soon();
    return this.settings(caller);
  }

  async list(
    caller: RequestUserFull,
    q: { status?: OutboxStatus; limit?: number; offset?: number },
  ): Promise<{ items: OutboxItem[]; counts: Record<OutboxStatus, number> }> {
    const tenantId = tenantOf(caller);
    const params: unknown[] = [tenantId];
    let where = 'm.tenant_id = $1';
    if (q.status) {
      params.push(q.status);
      where += ` AND m.status = $${params.length}`;
    }
    params.push(
      Math.min(Math.max(q.limit ?? 50, 1), 100),
      Math.max(q.offset ?? 0, 0),
    );
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT m.id, m.created_at, m.event_type, m.recipient_role, m.recipient, m.subject,
              m.status, m.attempts, m.last_error, m.sent_at, m.next_attempt_at, m.process_id,
              (m.html <> '') AS has_content, c.name AS client_name
         FROM message_outbox m
         LEFT JOIN processes p ON p.id = m.process_id AND p.tenant_id = m.tenant_id
         LEFT JOIN users c ON c.id = p.client_id AND c.tenant_id = m.tenant_id
        WHERE ${where}
        ORDER BY m.created_at DESC, m.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const totals = await this.dataSource.query<
      { status: OutboxStatus; n: number }[]
    >(
      `SELECT status, count(*)::int AS n FROM message_outbox WHERE tenant_id = $1 GROUP BY status`,
      [tenantId],
    );
    const counts = Object.fromEntries(
      OUTBOX_STATUSES.map((s) => [s, 0]),
    ) as Record<OutboxStatus, number>;
    for (const t of totals) if (t.status in counts) counts[t.status] = t.n;
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        createdAt: r.created_at as Date,
        eventType: r.event_type as string,
        recipientRole: r.recipient_role as string,
        recipient: r.recipient as string,
        subject: r.subject as string,
        status: r.status as OutboxStatus,
        attempts: r.attempts as number,
        lastError: (r.last_error as string | null) ?? null,
        sentAt: (r.sent_at as Date | null) ?? null,
        // só interessa enquanto a mensagem ainda vai sair
        nextAttemptAt:
          r.status === 'pending' ? (r.next_attempt_at as Date) : null,
        processId: (r.process_id as string | null) ?? null,
        clientName: (r.client_name as string | null) ?? null,
        hasContent: r.has_content === true,
      })),
      counts,
    };
  }

  // O gestor confere o que o cliente vai receber antes de liberar.
  async content(
    id: string,
    caller: RequestUserFull,
  ): Promise<{
    id: string;
    subject: string;
    recipient: string;
    html: string;
    text: string;
  }> {
    const [row] = await this.dataSource.query<
      {
        id: string;
        subject: string;
        recipient: string;
        html: string;
        text: string;
      }[]
    >(
      `SELECT id, subject, recipient, html, text FROM message_outbox WHERE id = $1 AND tenant_id = $2`,
      [id, tenantOf(caller)],
    );
    if (!row) throw new NotFoundException('Mensagem não encontrada');
    return row;
  }

  /** 'held' → 'pending': a mensagem entra na fila de envio agora. */
  async release(
    sel: Selection,
    caller: RequestUserFull,
  ): Promise<{ released: number }> {
    const released = await this.move(
      sel,
      caller,
      `status = 'held'`,
      `status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL`,
      'email_released',
    );
    if (released > 0) this.worker.soon();
    return { released };
  }

  /** O que ainda não saiu ('held' ou 'pending') deixa de ser enviado. */
  async cancel(
    sel: Selection,
    caller: RequestUserFull,
  ): Promise<{ cancelled: number }> {
    const cancelled = await this.move(
      sel,
      caller,
      `status IN ('held', 'pending')`,
      `status = 'cancelled'`,
      'email_cancelled',
    );
    return { cancelled };
  }

  /** Falhou, venceu ou foi cancelada: o gestor manda de novo (é uma liberação). */
  async resend(
    id: string,
    caller: RequestUserFull,
  ): Promise<{ resent: number }> {
    const resent = await this.move(
      { ids: [id] },
      caller,
      `status IN ('failed', 'expired', 'cancelled') AND html <> ''`,
      `status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL`,
      'email_resent',
    );
    if (resent === 0) {
      const [row] = await this.dataSource.query<
        { status: OutboxStatus; has_content: boolean }[]
      >(
        `SELECT status, (html <> '') AS has_content FROM message_outbox WHERE id = $1 AND tenant_id = $2`,
        [id, tenantOf(caller)],
      );
      if (!row) throw new NotFoundException('Mensagem não encontrada');
      throw new ConflictException(
        row.has_content
          ? 'Só dá para reenviar mensagens que falharam, venceram ou foram canceladas'
          : 'Convites e redefinições de senha não ficam guardados: gere um novo pelo cadastro da pessoa',
      );
    }
    this.worker.soon();
    return { resent };
  }

  // Muda a situação das mensagens escolhidas e registra cada uma no Log de
  // Ações, tudo no mesmo comando (ou muda e registra, ou nada).
  private async move(
    sel: Selection,
    caller: RequestUserFull,
    from: string,
    set: string,
    action: string,
  ): Promise<number> {
    const ids = sel.ids ?? [];
    if (!sel.all && ids.length === 0) {
      throw new BadRequestException('Escolha as mensagens ou use "todas"');
    }
    const params: unknown[] = [tenantOf(caller), caller.userId, action];
    let filter = '';
    if (!sel.all) {
      params.push(ids);
      filter = ` AND id = ANY($4::uuid[])`;
    }
    const rows = await this.dataSource.query<unknown[]>(
      `WITH moved AS (
         UPDATE message_outbox SET ${set}, updated_at = now()
          WHERE tenant_id = $1 AND ${from}${filter}
         RETURNING id, tenant_id, process_id, event_type, recipient_role, subject)
       INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
       SELECT tenant_id, process_id, $2::uuid, $3::varchar,
              jsonb_build_object('messageId', id, 'eventType', event_type,
                                 'recipientRole', recipient_role, 'subject', subject)
         FROM moved
       RETURNING 1`,
      params,
    );
    return affected(rows);
  }

  // Convite, redefinição de senha e teste: já saíram (ou falharam) na hora;
  // entram na lista do gestor sem o conteúdo, que tem link de acesso.
  async recordDirect(sent: DirectSend): Promise<void> {
    if (!sent.tenantId) return; // conta sem assessoria (Super Admin)
    try {
      await this.dataSource.query(
        `WITH m AS (
           INSERT INTO message_outbox
             (tenant_id, event_type, recipient_role, recipient, subject, html, text,
              status, attempts, sent_at, last_error)
           VALUES ($1, $2, $3, $4, $5, '', '', $6::varchar, 1,
                   CASE WHEN $6::varchar = 'sent' THEN now() END, $7)
           RETURNING id, tenant_id, event_type, recipient_role, subject)
         INSERT INTO audit_logs (tenant_id, actor_id, action, metadata)
         SELECT tenant_id, $8::uuid, $9::varchar,
                jsonb_build_object('messageId', id, 'eventType', event_type,
                                   'recipientRole', recipient_role, 'subject', subject,
                                   'direct', true)
           FROM m`,
        [
          sent.tenantId,
          sent.eventType,
          sent.recipientRole,
          sent.to,
          sent.subject.slice(0, 255),
          sent.ok ? 'sent' : 'failed',
          sent.ok ? null : (sent.error ?? 'Falha no envio').slice(0, 500),
          sent.actorId ?? null,
          sent.ok ? 'email_sent' : 'email_failed',
        ],
      );
    } catch (err) {
      this.logger.warn(
        `Envio direto (${sent.eventType}) não registrado: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function tenantOf(caller: RequestUserFull): string {
  if (!caller.tenantId)
    throw new NotFoundException('Assessoria não encontrada');
  return caller.tenantId;
}

// TypeORM devolve [linhas, quantidade] para UPDATE/DELETE e só as linhas para
// INSERT ... RETURNING.
function affected(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[1];
  }
  return result.length;
}
