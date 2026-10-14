import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import {
  buildSummary,
  clampDays,
  type DashboardSummary,
  type HistoryRow,
  type SnapshotRow,
} from './dashboard-summary';
import {
  buildByAnalista,
  buildSla,
  type AnalistaRef,
  type AnalistaSla,
  type AnalysisRow,
  type DocsRow,
  type SlaRow,
  type SlaSummary,
} from './dashboard-sla';

export const SUMMARY_TTL_MS = 5 * 60_000;

export type DashboardView = DashboardSummary & { sla: SlaSummary };

@Injectable()
export class DashboardService {
  // 5-minute cache per tenant, view (gestor = whole tenant, analista = own
  // processes) and period. Kept per instance; a stale read is at most 5 min old.
  private readonly cache = new Map<
    string,
    { at: number; value: DashboardView }
  >();

  constructor(private readonly dataSource: DataSource) {}

  async summary(
    caller: RequestUserFull,
    daysParam?: string,
  ): Promise<DashboardView> {
    const days = clampDays(daysParam);
    const own = caller.role === 'analista';
    const key = `${caller.tenantId}:${own ? caller.userId : '*'}:${days}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < SUMMARY_TTL_MS) return hit.value;

    // Same visibility as GET /processes: the analista only sees their own
    const params: unknown[] = [caller.tenantId];
    let ownFilter = '';
    if (own) {
      params.push(caller.userId);
      ownFilter = 'AND p.analista_id = $2';
    }

    const snapshot = await this.dataSource.query<SnapshotRow[]>(
      `SELECT p.stage, p.stage_before_pendencia, p.created_at,
              COALESCE(p.valor_unidade, un.valor) AS valor
         FROM processes p
         LEFT JOIN unidades un ON un.id = p.unidade_id
        WHERE p.tenant_id = $1 AND p.active = true ${ownFilter}`,
      params,
    );
    const history = await this.dataSource.query<HistoryRow[]>(
      `WITH ch AS (
         SELECT al.process_id, al.action, al.from_state, al.to_state, al.created_at,
                LAG(al.created_at) OVER (
                  PARTITION BY al.process_id ORDER BY al.created_at
                ) AS prev_at
           FROM audit_logs al
           JOIN processes p ON p.id = al.process_id
          WHERE al.tenant_id = $1 AND p.active = true ${ownFilter}
            AND al.action IN ('stage_change', 'stage_change_undo')
       )
       SELECT ch.action, ch.from_state, ch.to_state,
              EXTRACT(EPOCH FROM (ch.created_at - COALESCE(ch.prev_at, p.created_at))) / 86400
                AS days_in_from
         FROM ch
         JOIN processes p ON p.id = ch.process_id
        WHERE ch.created_at >= now() - make_interval(days => $${params.length + 1}::int)`,
      [...params, days],
    );
    const sla = await this.slaRows(
      caller.tenantId!,
      own ? caller.userId : null,
    );

    const value: DashboardView = {
      ...buildSummary(days, snapshot, history, new Date(now)),
      sla: buildSla(sla, new Date(now)),
    };
    for (const [k, v] of this.cache) {
      if (now - v.at >= SUMMARY_TTL_MS) this.cache.delete(k);
    }
    this.cache.set(key, { at: now, value });
    return value;
  }

  // PROD-10: active processes with the moment each entered its current stage
  // (last stage change or undo; creation when it never moved).
  private slaRows(tenantId: string, analistaId: string | null) {
    const params: unknown[] = [tenantId];
    let ownFilter = '';
    if (analistaId) {
      params.push(analistaId);
      ownFilter = 'AND p.analista_id = $2';
    }
    return this.dataSource.query<SlaRow[]>(
      `SELECT p.id, p.stage, p.analista_id,
              NULLIF(concat_ws(' ', c.name, c.surname), '') AS client_name,
              c.email AS client_email,
              COALESCE(last.at, p.created_at) AS stage_since
         FROM processes p
         JOIN users c ON c.id = p.client_id
         LEFT JOIN LATERAL (
           SELECT max(al.created_at) AS at
             FROM audit_logs al
            WHERE al.process_id = p.id
              AND al.action IN ('stage_change', 'stage_change_undo')
         ) last ON true
        WHERE p.tenant_id = $1 AND p.active = true ${ownFilter}`,
      params,
    );
  }

  // PROD-10: SLA of each analista of the assessoria (gestor only — the
  // controller refuses other roles). Averages use the stage changes of the period.
  async byAnalista(
    caller: RequestUserFull,
    daysParam?: string,
  ): Promise<{ days: number; slaDays: number; analistas: AnalistaSla[] }> {
    const days = clampDays(daysParam);
    const tenantId = caller.tenantId!;
    const analistas = await this.dataSource.query<AnalistaRef[]>(
      `SELECT id, name, surname, email, status
         FROM users
        WHERE tenant_id = $1 AND role = 'analista'`,
      [tenantId],
    );
    const sla = await this.slaRows(tenantId, null);
    const docs = await this.dataSource.query<DocsRow[]>(
      `SELECT p.analista_id, COUNT(*) FILTER (WHERE d.status = 'recebido') AS to_validate
         FROM documents d
         JOIN processes p ON p.id = d.process_id
        WHERE d.tenant_id = $1 AND p.tenant_id = $1 AND p.active = true
        GROUP BY p.analista_id`,
      [tenantId],
    );
    const analysis = await this.dataSource.query<AnalysisRow[]>(
      `WITH ch AS (
         SELECT al.process_id, al.action, al.from_state, al.created_at,
                LAG(al.created_at) OVER (
                  PARTITION BY al.process_id ORDER BY al.created_at
                ) AS prev_at
           FROM audit_logs al
           JOIN processes p ON p.id = al.process_id
          WHERE al.tenant_id = $1 AND p.active = true
            AND al.action IN ('stage_change', 'stage_change_undo')
       )
       SELECT p.analista_id, ch.from_state,
              EXTRACT(EPOCH FROM (ch.created_at - COALESCE(ch.prev_at, p.created_at))) / 86400
                AS days_in_from
         FROM ch
         JOIN processes p ON p.id = ch.process_id
        WHERE ch.action = 'stage_change'
          AND ch.from_state IN ('analise_credito', 'analise_juridica')
          AND ch.created_at >= now() - make_interval(days => $2::int)`,
      [tenantId, days],
    );
    const now = new Date();
    return {
      days,
      slaDays: buildSla([], now).days,
      analistas: buildByAnalista(analistas, sla, docs, analysis, now),
    };
  }
}
