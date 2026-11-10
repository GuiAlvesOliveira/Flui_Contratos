import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { SLA_EXEMPT } from '../dashboard/dashboard-sla';
import {
  daysUntil,
  dueText,
  EXPIRING_DAYS,
  formatDateBr,
  todayInSaoPaulo,
  validityStatus,
  type ValidityStatus,
} from '../documents/document-validity';
import type { ProcessStage } from '../processes/process.entity';

// Espaço das travas consultivas (pg_advisory_xact_lock) da rotina; a segunda
// chave é o hash do documento, então documentos diferentes não se bloqueiam.
export const DOCUMENT_EXPIRY_LOCK = 51182011;

export type ExpiryKind = 'document_expiring' | 'document_expired';
type RecipientRole = 'cliente' | 'analista' | 'gestor';

// Processos encerrados (Assinatura, Inativo, Crédito recusado) não esperam mais
// documento: os mesmos estágios que não contam no prazo de atendimento (PROD-10).
const CLOSED_STAGES: ProcessStage[] = SLA_EXEMPT;

// Processo ativo e em andamento que usa o documento: o próprio processo, ou —
// documento pessoal, que vale para todos os processos do cliente — os
// processos do cliente na mesma assessoria.
const USES_DOCUMENT = `
  p.tenant_id = d.tenant_id AND p.active = true AND p.stage <> ALL($3::text[])
  AND (p.id = d.process_id OR (d.process_id IS NULL AND p.client_id = d.user_id))`;

// Validados com mês de referência que vencem em até 15 dias ou já venceram,
// ainda sem o aviso do ciclo (ou vencidos ainda não marcados). $1 hoje,
// $2 dias de antecedência, $3 etapas encerradas.
const CANDIDATES_SQL = `
  SELECT d.id
    FROM documents d
   WHERE d.status = 'validado'
     AND d.valid_until IS NOT NULL
     AND d.valid_until <= $1::date + $2::int
     AND EXISTS (SELECT 1 FROM processes p WHERE ${USES_DOCUMENT})
     AND (
       (d.valid_until < $1::date AND d.expired_at IS NULL)
       OR NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.document_id = d.id
            AND n.valid_until = d.valid_until
            AND n.kind = CASE WHEN d.valid_until < $1::date
                              THEN 'document_expired' ELSE 'document_expiring' END
       )
     )
   ORDER BY d.valid_until, d.id`;

interface DocRow {
  id: string;
  tenant_id: string;
  process_id: string | null;
  user_id: string | null;
  label: string;
  valid_until: string;
  expired_at: Date | null;
  client_name: string | null;
  client_status: string | null;
}

interface ProcessRow {
  id: string;
  analista_id: string | null;
  analista_status: string | null;
}

interface Recipient {
  id: string;
  role: RecipientRole;
  processId: string;
}

export interface ExpiryRun {
  today: string;
  checked: number;
  expired: number;
  notifications: number;
  skipped: number;
  failed: number;
}

/** Texto do aviso, gravado na notificação (com a data, para não envelhecer). */
export function expiryMessage(
  kind: ExpiryKind,
  role: RecipientRole,
  doc: { label: string; validUntil: string; clientName: string | null },
  today: string,
): string {
  const date = formatDateBr(doc.validUntil);
  if (role === 'cliente') {
    return kind === 'document_expiring'
      ? `Seu documento "${doc.label}" ${dueText(doc.validUntil, today)} (${date}). Envie um documento mais recente.`
      : `Seu documento "${doc.label}" está vencido (valia até ${date}). Envie um documento mais recente para o processo continuar.`;
  }
  const client = doc.clientName ?? 'cliente';
  return kind === 'document_expiring'
    ? `"${doc.label}" de ${client} ${dueText(doc.validUntil, today)} (${date}). Peça um documento mais recente ao cliente.`
    : `"${doc.label}" de ${client} está vencido (valia até ${date}). O processo não avança de etapa até um documento novo ser validado.`;
}

/**
 * Validade de documentos pelo mês de referência — a rotina diária e as listas
 * de documentos vencendo/vencidos.
 *
 * A rotina procura os documentos validados que vencem em até 15 dias ou já
 * venceram e, para cada um, numa transação própria com trava do documento
 * (pg_advisory_xact_lock + FOR UPDATE): marca o vencido (pendência no RN-04 e
 * registro no histórico), cria os avisos que faltam — para o cliente e para o
 * analista responsável (sem analista ativo, os gestores) — e registra cada
 * aviso no histórico do processo. Antes de criar, confere se o aviso já existe
 * para o documento, o tipo e o destinatário naquele ciclo de validade; o índice
 * único da tabela garante o mesmo com duas instâncias da API ao mesmo tempo.
 */
@Injectable()
export class DocumentExpiryService {
  private readonly logger = new Logger(DocumentExpiryService.name);

  constructor(private readonly dataSource: DataSource) {}

  async run(now = new Date()): Promise<ExpiryRun> {
    const today = todayInSaoPaulo(now);
    const candidates = await this.dataSource.query<{ id: string }[]>(
      CANDIDATES_SQL,
      [today, EXPIRING_DAYS, CLOSED_STAGES],
    );
    const result: ExpiryRun = {
      today,
      checked: candidates.length,
      expired: 0,
      notifications: 0,
      skipped: 0,
      failed: 0,
    };
    for (const { id } of candidates) {
      try {
        const done = await this.processDocument(id, today);
        if (!done || (!done.expired && done.created === 0)) result.skipped++;
        if (done?.expired) result.expired++;
        result.notifications += done?.created ?? 0;
      } catch (err) {
        // um documento com problema não impede os outros; tenta de novo amanhã
        result.failed++;
        this.logger.error(
          `Validade do documento ${id} falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return result;
  }

  /** Um documento; null quando ele já não precisa de nada (ou outra instância já tratou). */
  async processDocument(
    documentId: string,
    today: string,
  ): Promise<{ expired: boolean; created: number } | null> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [
        DOCUMENT_EXPIRY_LOCK,
        documentId,
      ]);
      const [doc] = await manager.query<DocRow[]>(
        `SELECT d.id, d.tenant_id, d.process_id, d.user_id,
                COALESCE(d.label, d.name) AS label,
                d.valid_until::text AS valid_until, d.expired_at,
                NULLIF(concat_ws(' ', c.name, c.surname), '') AS client_name,
                c.status AS client_status
           FROM documents d
           LEFT JOIN users c ON c.id = d.user_id AND c.tenant_id = d.tenant_id
          WHERE d.id = $1 AND d.status = 'validado' AND d.valid_until IS NOT NULL
            AND d.valid_until <= $2::date + $3::int
          FOR UPDATE OF d`,
        [documentId, today, EXPIRING_DAYS],
      );
      if (!doc) return null;
      const processes = await manager.query<ProcessRow[]>(
        `SELECT p.id, p.analista_id, a.status AS analista_status
           FROM processes p
           LEFT JOIN users a ON a.id = p.analista_id
          WHERE p.tenant_id = $1 AND p.active = true AND p.stage <> ALL($2::text[])
            AND ${doc.process_id ? 'p.id = $3' : 'p.client_id = $3'}
          ORDER BY p.created_at, p.id`,
        [doc.tenant_id, CLOSED_STAGES, doc.process_id ?? doc.user_id],
      );
      if (processes.length === 0) return null;

      const kind: ExpiryKind =
        doc.valid_until < today ? 'document_expired' : 'document_expiring';
      const meta = {
        docId: doc.id,
        label: doc.label,
        validUntil: doc.valid_until,
      };

      // Vencido: marca o documento — ele vira pendência (o RN-04 trava o
      // avanço) — e registra no histórico de cada processo que o usa.
      let expired = false;
      if (kind === 'document_expired' && !doc.expired_at) {
        await manager.query(
          `UPDATE documents SET expired_at = now() WHERE id = $1`,
          [doc.id],
        );
        for (const p of processes) {
          await this.audit(
            manager,
            doc.tenant_id,
            p.id,
            'document_expired',
            meta,
          );
        }
        expired = true;
      }

      let created = 0;
      for (const r of await this.recipients(manager, doc, processes)) {
        const [exists] = await manager.query<unknown[]>(
          `SELECT 1 FROM notifications
            WHERE document_id = $1 AND kind = $2 AND recipient_id = $3 AND valid_until = $4::date`,
          [doc.id, kind, r.id, doc.valid_until],
        );
        if (exists) continue;
        const message = expiryMessage(
          kind,
          r.role,
          {
            label: doc.label,
            validUntil: doc.valid_until,
            clientName: doc.client_name,
          },
          today,
        );
        const [n] = await manager.query<{ id: string }[]>(
          `INSERT INTO notifications
             (tenant_id, process_id, recipient_id, document_id, kind, message, valid_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7::date)
           ON CONFLICT (document_id, kind, recipient_id, valid_until) DO NOTHING
           RETURNING id`,
          [
            doc.tenant_id,
            r.processId,
            r.id,
            doc.id,
            kind,
            message,
            doc.valid_until,
          ],
        );
        if (!n) continue;
        created++;
        await this.audit(
          manager,
          doc.tenant_id,
          r.processId,
          'document_expiry_notice',
          {
            ...meta,
            notificationId: n.id,
            kind,
            recipientId: r.id,
            recipientRole: r.role,
          },
        );
      }
      return { expired, created };
    });
  }

  // O cliente dono do documento (num documento pessoal, no primeiro processo
  // em andamento) e, em cada processo, o analista responsável se estiver ativo;
  // sem ele, os gestores da assessoria. Cada pessoa recebe um aviso só.
  private async recipients(
    manager: EntityManager,
    doc: DocRow,
    processes: ProcessRow[],
  ): Promise<Recipient[]> {
    const list: Recipient[] = [];
    const add = (r: Recipient) => {
      if (!list.some((x) => x.id === r.id)) list.push(r);
    };
    if (doc.user_id && doc.client_status && doc.client_status !== 'disabled') {
      add({
        id: doc.user_id,
        role: 'cliente',
        processId: doc.process_id ?? processes[0].id,
      });
    }
    let gestores: string[] | null = null;
    for (const p of processes) {
      if (p.analista_id && p.analista_status !== 'disabled') {
        add({ id: p.analista_id, role: 'analista', processId: p.id });
        continue;
      }
      gestores ??= (
        await manager.query<{ id: string }[]>(
          `SELECT id FROM users
            WHERE tenant_id = $1 AND role = 'dono' AND status <> 'disabled'
            ORDER BY created_at`,
          [doc.tenant_id],
        )
      ).map((g) => g.id);
      for (const id of gestores) add({ id, role: 'gestor', processId: p.id });
    }
    return list;
  }

  private audit(
    manager: EntityManager,
    tenantId: string,
    processId: string,
    action: string,
    metadata: object,
  ) {
    return manager.query(
      `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
       VALUES ($1, $2, NULL, $3, $4::jsonb)`,
      [tenantId, processId, action, JSON.stringify(metadata)],
    );
  }

  /**
   * Painel da equipe: processos com documento vencendo ou vencido — os do
   * analista, ou todos da assessoria para o gestor. Vencidos primeiro.
   */
  async processes(caller: RequestUserFull, now = new Date()) {
    const today = todayInSaoPaulo(now);
    const params: unknown[] = [
      caller.tenantId,
      today,
      CLOSED_STAGES,
      EXPIRING_DAYS,
    ];
    let own = '';
    if (caller.role === 'analista') {
      params.push(caller.userId);
      own = 'AND p.analista_id = $5';
    }
    const rows = await this.dataSource.query<
      {
        process_id: string;
        stage: ProcessStage;
        client_name: string | null;
        client_email: string;
        analista_name: string | null;
        document_id: string;
        label: string;
        valid_until: string;
      }[]
    >(
      `SELECT p.id AS process_id, p.stage,
              NULLIF(concat_ws(' ', c.name, c.surname), '') AS client_name,
              c.email AS client_email,
              NULLIF(concat_ws(' ', a.name, a.surname), '') AS analista_name,
              d.id AS document_id, COALESCE(d.label, d.name) AS label,
              d.valid_until::text AS valid_until
         FROM processes p
         JOIN users c ON c.id = p.client_id
         LEFT JOIN users a ON a.id = p.analista_id
         JOIN documents d ON d.tenant_id = p.tenant_id
          AND (d.process_id = p.id OR (d.process_id IS NULL AND d.user_id = p.client_id))
        WHERE p.tenant_id = $1 AND p.active = true AND p.stage <> ALL($3::text[])
          AND d.status = 'validado' AND d.valid_until IS NOT NULL
          AND d.valid_until <= $2::date + $4::int
          ${own}
        ORDER BY d.valid_until, d.id`,
      params,
    );

    const byProcess = new Map<
      string,
      {
        processId: string;
        stage: ProcessStage;
        clientName: string;
        analistaName: string | null;
        expired: number;
        expiring: number;
        documents: ExpiryDocument[];
      }
    >();
    for (const r of rows) {
      let p = byProcess.get(r.process_id);
      if (!p) {
        p = {
          processId: r.process_id,
          stage: r.stage,
          clientName: r.client_name ?? r.client_email,
          analistaName: r.analista_name,
          expired: 0,
          expiring: 0,
          documents: [],
        };
        byProcess.set(r.process_id, p);
      }
      const d = expiryDocument(r.document_id, r.label, r.valid_until, today);
      if (d.status === 'vencido') p.expired++;
      else p.expiring++;
      p.documents.push(d);
    }
    // vencidos primeiro; depois quem vence antes (as linhas já vêm por data)
    const processes = [...byProcess.values()].sort(
      (a, b) => Number(b.expired > 0) - Number(a.expired > 0),
    );
    return { today, expiringDays: EXPIRING_DAYS, processes };
  }

  /**
   * Portal do cliente: os documentos dele vencidos (aviso no topo) e vencendo,
   * com o processo onde enviar um mais recente.
   */
  async mine(caller: RequestUserFull, now = new Date()) {
    const today = todayInSaoPaulo(now);
    const rows = await this.dataSource.query<
      {
        document_id: string;
        label: string;
        valid_until: string;
        process_id: string;
      }[]
    >(
      `SELECT d.id AS document_id, COALESCE(d.label, d.name) AS label,
              d.valid_until::text AS valid_until,
              COALESCE(d.process_id, (
                SELECT p.id FROM processes p
                 WHERE ${USES_DOCUMENT}
                 ORDER BY p.created_at, p.id LIMIT 1
              )) AS process_id
         FROM documents d
        WHERE d.tenant_id = $1 AND d.user_id = $2
          AND d.status = 'validado' AND d.valid_until IS NOT NULL
          AND d.valid_until <= $4::date + $5::int
          AND EXISTS (SELECT 1 FROM processes p WHERE ${USES_DOCUMENT})
        ORDER BY d.valid_until, d.id`,
      [caller.tenantId, caller.userId, CLOSED_STAGES, today, EXPIRING_DAYS],
    );
    const docs = rows.map((r) => ({
      ...expiryDocument(r.document_id, r.label, r.valid_until, today),
      processId: r.process_id,
    }));
    return {
      today,
      expired: docs.filter((d) => d.status === 'vencido'),
      expiring: docs.filter((d) => d.status !== 'vencido'),
    };
  }
}

export interface ExpiryDocument {
  documentId: string;
  label: string;
  validUntil: string;
  status: ValidityStatus;
  daysLeft: number;
}

function expiryDocument(
  documentId: string,
  label: string,
  validUntil: string,
  today: string,
): ExpiryDocument {
  return {
    documentId,
    label,
    validUntil,
    status: validityStatus(validUntil, today),
    daysLeft: daysUntil(validUntil, today),
  };
}
