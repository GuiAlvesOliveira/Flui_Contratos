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

export const SUMMARY_TTL_MS = 5 * 60_000;

@Injectable()
export class DashboardService {
  // 5-minute cache per tenant, view (gestor = whole tenant, analista = own
  // processes) and period. Kept per instance; a stale read is at most 5 min old.
  private readonly cache = new Map<
    string,
    { at: number; value: DashboardSummary }
  >();

  constructor(private readonly dataSource: DataSource) {}

  async summary(
    caller: RequestUserFull,
    daysParam?: string,
  ): Promise<DashboardSummary> {
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

    const value = buildSummary(days, snapshot, history, new Date(now));
    for (const [k, v] of this.cache) {
      if (now - v.at >= SUMMARY_TTL_MS) this.cache.delete(k);
    }
    this.cache.set(key, { at: now, value });
    return value;
  }
}
