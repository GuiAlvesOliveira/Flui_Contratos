import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { SLA_DAYS, SLA_EXEMPT } from '../dashboard/dashboard-sla';
import { MessagingService } from '../messaging/messaging.service';
import type { ProcessStage } from '../processes/process.entity';

// Espaço das travas consultivas (pg_advisory_xact_lock) do alerta; a segunda
// chave é o hash do processo, então processos diferentes não se bloqueiam.
export const ESCALATION_LOCK = 51182010;

interface StalledRow {
  id: string;
  tenant_id: string;
  stage: ProcessStage;
  analista_id: string | null;
  analista_status: string | null;
  analista_name: string | null;
  client_name: string | null;
  stage_since: Date;
  days: number;
}

export interface EscalationRun {
  days: number;
  checked: number;
  alerted: number;
  messages: number;
  skipped: number;
  failed: number;
}

// Processo ativo, fora de Assinatura/Inativo/Crédito Recusado, na mesma etapa
// há mais de N dias (desde a última mudança de etapa ou a criação) e sem
// alerta nos últimos N dias. Mesma regra de "fora do prazo" do PROD-10.
const STALLED_SQL = `
  SELECT p.id, p.tenant_id, p.stage, p.analista_id,
         a.status AS analista_status,
         NULLIF(concat_ws(' ', a.name, a.surname), '') AS analista_name,
         NULLIF(concat_ws(' ', c.name, c.surname), '') AS client_name,
         COALESCE(last.at, p.created_at) AS stage_since,
         floor(EXTRACT(EPOCH FROM (now() - COALESCE(last.at, p.created_at))) / 86400)::int AS days
    FROM processes p
    JOIN users c ON c.id = p.client_id
    LEFT JOIN users a ON a.id = p.analista_id
    LEFT JOIN LATERAL (
      SELECT max(al.created_at) AS at
        FROM audit_logs al
       WHERE al.process_id = p.id
         AND al.action IN ('stage_change', 'stage_change_undo')
    ) last ON true
   WHERE p.active = true
     AND p.stage <> ALL($1::text[])
     AND COALESCE(last.at, p.created_at) < now() - make_interval(days => $2::int)
     AND NOT EXISTS (
       SELECT 1 FROM process_escalations e
        WHERE e.process_id = p.id
          AND e.created_at > now() - make_interval(days => $2::int)
     )`;

const positiveInt = (raw: unknown, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * PROD-05_v2 — escalação automática de processos parados. O job diário chama
 * run(); cada processo é tratado numa transação própria que trava o processo
 * (pg_advisory_xact_lock), confere de novo se ele ainda está parado e sem
 * alerta recente, grava o alerta e enfileira o e-mail na message_outbox — tudo
 * junto. Com mais de uma instância da API, a segunda espera a trava, vê o
 * alerta já gravado e não repete.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);
  readonly days: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly messaging: MessagingService,
    config: ConfigService,
  ) {
    this.days = positiveInt(config.get('ESCALATION_DAYS'), SLA_DAYS);
  }

  async run(): Promise<EscalationRun> {
    const candidates = await this.dataSource.query<{ id: string }[]>(
      `SELECT s.id FROM (${STALLED_SQL}) s ORDER BY s.stage_since`,
      [SLA_EXEMPT, this.days],
    );
    const result: EscalationRun = {
      days: this.days,
      checked: candidates.length,
      alerted: 0,
      messages: 0,
      skipped: 0,
      failed: 0,
    };
    for (const { id } of candidates) {
      try {
        const sent = await this.escalate(id);
        if (sent === null) result.skipped++;
        else {
          result.alerted++;
          result.messages += sent;
        }
      } catch (err) {
        // um processo com problema não impede os outros; tenta de novo amanhã
        result.failed++;
        this.logger.error(
          `Alerta do processo ${id} falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return result;
  }

  /** Alerta um processo; null quando ele já não precisa (ou outra instância já alertou). */
  async escalate(processId: string): Promise<number | null> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
        ESCALATION_LOCK,
        processId,
      ]);
      const [p] = await manager.query<StalledRow[]>(
        `${STALLED_SQL} AND p.id = $3`,
        [SLA_EXEMPT, this.days, processId],
      );
      if (!p) return null;

      // O analista responsável, se estiver ativo; senão, os gestores da assessoria.
      let role: 'analista' | 'gestor' = 'analista';
      let ids: string[] = [];
      if (p.analista_id && p.analista_status !== 'disabled') {
        ids = [p.analista_id];
      } else {
        role = 'gestor';
        const gestores = await manager.query<{ id: string }[]>(
          `SELECT id FROM users
            WHERE tenant_id = $1 AND role = 'dono' AND status <> 'disabled'
            ORDER BY created_at`,
          [p.tenant_id],
        );
        ids = gestores.map((g) => g.id);
      }

      const [e] = await manager.query<{ id: string }[]>(
        `INSERT INTO process_escalations
           (tenant_id, process_id, stage, stage_since, days_in_stage, recipient_role, recipient_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[])
         RETURNING id`,
        [p.tenant_id, p.id, p.stage, p.stage_since, p.days, role, ids],
      );
      const messages = await this.messaging.processStalled(manager, {
        tenantId: p.tenant_id,
        processId: p.id,
        clientName: p.client_name,
        stage: p.stage,
        days: p.days,
        since: new Date(p.stage_since),
        limitDays: this.days,
        reason:
          role === 'analista'
            ? 'analista'
            : p.analista_id
              ? 'analista_desativado'
              : 'sem_analista',
        analistaName: p.analista_name,
        recipients: ids.map((id) => ({ id, role })),
      });
      await manager.query(
        `UPDATE process_escalations SET messages = $1 WHERE id = $2`,
        [messages, e.id],
      );
      return messages;
    });
  }
}
