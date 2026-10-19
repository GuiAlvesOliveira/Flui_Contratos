import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { clampDays } from '../dashboard/dashboard-summary';
import { DashboardService } from '../dashboard/dashboard.service';
import { STAGE_LABELS, type ProcessStage } from '../processes/process.entity';
import { reportPdf, reportXlsx, type ReportModel } from './report-files';

const SIDE_STAGES: ProcessStage[] = [
  'cliente_inativo',
  'credito_recusado',
  'processo_pendencia',
];
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface RankingRow {
  analistaId: string | null;
  name: string;
  signed: number;
  activeProcesses: number;
  avgDays: number | null;
}

interface AnalistaRow {
  id: string;
  name: string | null;
  surname: string | null;
  email: string;
  status: string;
  active: string;
}
interface ActivityRow {
  analista_id: string | null;
  signed: string;
  avg_days: string | null;
}

export type ReportFormat = 'xlsx' | 'pdf';

/**
 * PROD-03 — relatórios do gestor. Funil, tempo por etapa e ticket médio vêm do
 * mesmo cálculo de GET /dashboard/summary (DashboardService, com o mesmo cache);
 * o ranking usa as mudanças de etapa do período (base do PROD-10). Tudo da
 * assessoria de quem chama (RN-01).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly dashboard: DashboardService,
  ) {}

  // Ranking de analistas: contratos assinados e tempo médio por etapa no
  // período, e processos ativos agora. Mesma regra do resumo: só processos
  // ativos, e cada entrada em Assinatura conta como contrato assinado.
  async ranking(
    caller: RequestUserFull,
    daysParam?: string,
  ): Promise<{ days: number; analistas: RankingRow[] }> {
    const days = clampDays(daysParam);
    const tenantId = caller.tenantId!;
    const analistas = await this.dataSource.query<AnalistaRow[]>(
      `SELECT u.id, u.name, u.surname, u.email, u.status,
              (SELECT COUNT(*) FROM processes p
                WHERE p.tenant_id = $1 AND p.active = true AND p.analista_id = u.id) AS active
         FROM users u
        WHERE u.tenant_id = $1 AND u.role = 'analista'`,
      [tenantId],
    );
    const activity = await this.dataSource.query<ActivityRow[]>(
      `WITH ch AS (
         SELECT al.process_id, al.action, al.to_state, al.created_at,
                LAG(al.created_at) OVER (PARTITION BY al.process_id ORDER BY al.created_at) AS prev_at
           FROM audit_logs al
           JOIN processes p ON p.id = al.process_id
          WHERE al.tenant_id = $1 AND p.active = true
            AND al.action IN ('stage_change', 'stage_change_undo')
       ), period AS (
         SELECT p.analista_id,
                COUNT(*) FILTER (WHERE ch.to_state = 'assinatura') AS signed,
                AVG(EXTRACT(EPOCH FROM (ch.created_at - COALESCE(ch.prev_at, p.created_at))) / 86400) AS avg_days
           FROM ch JOIN processes p ON p.id = ch.process_id
          WHERE ch.action = 'stage_change'
            AND ch.created_at >= now() - make_interval(days => $2::int)
          GROUP BY p.analista_id
       )
       SELECT analista_id, signed, avg_days FROM period`,
      [tenantId, days],
    );
    const byId = new Map(activity.map((a) => [a.analista_id, a]));
    const row = (
      id: string | null,
      name: string,
      active: number,
    ): RankingRow => {
      const a = byId.get(id);
      const avg =
        a?.avg_days === null || a?.avg_days === undefined
          ? null
          : Number(a.avg_days);
      return {
        analistaId: id,
        name,
        signed: Number(a?.signed ?? 0),
        activeProcesses: active,
        avgDays: avg !== null && Number.isFinite(avg) ? round1(avg) : null,
      };
    };
    const rows = analistas
      .filter(
        (u) =>
          u.status !== 'disabled' || Number(u.active) > 0 || byId.has(u.id),
      )
      .map((u) =>
        row(
          u.id,
          [u.name, u.surname].filter(Boolean).join(' ') || u.email,
          Number(u.active),
        ),
      );
    const [unassigned] = await this.dataSource.query<{ n: string }[]>(
      `SELECT COUNT(*) AS n FROM processes WHERE tenant_id = $1 AND active = true AND analista_id IS NULL`,
      [tenantId],
    );
    if (Number(unassigned.n) > 0 || byId.has(null))
      rows.push(row(null, 'Sem analista', Number(unassigned.n)));
    rows.sort(
      (a, b) =>
        b.signed - a.signed ||
        b.activeProcesses - a.activeProcesses ||
        a.name.localeCompare(b.name, 'pt-BR'),
    );
    return { days, analistas: rows };
  }

  // O mesmo conteúdo da tela, montado uma vez para a planilha e o PDF.
  async model(
    caller: RequestUserFull,
    daysParam?: string,
  ): Promise<ReportModel> {
    const days = clampDays(daysParam);
    const summary = await this.dashboard.summary(caller, String(days));
    const { analistas } = await this.ranking(caller, String(days));
    const [tenant] = await this.dataSource.query<{ name: string }[]>(
      `SELECT name FROM tenants WHERE id = $1`,
      [caller.tenantId],
    );
    const generatedAt = new Date(summary.generatedAt);
    const day = (d: Date) =>
      d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    return {
      tenantName: tenant?.name ?? 'Assessoria',
      days,
      from: day(new Date(generatedAt.getTime() - days * 86_400_000)),
      to: day(generatedAt),
      generatedAt,
      kpis: {
        processes: summary.totals.processes,
        unitValue: summary.totals.unitValue,
        averageTicket: summary.totals.averageTicket,
        withValue: summary.totals.withValue,
        newProcesses: summary.period.newProcesses,
        stageChanges: summary.period.stageChanges,
        signed: summary.period.signed,
      },
      funnel: summary.funnel.map((f) => ({
        label: STAGE_LABELS[f.stage],
        reached: f.reached,
        pctOfTotal: f.pctOfTotal,
        stepRate: f.stepRate,
      })),
      // Igual à tela: etapas laterais só quando houve saída no período
      stageTime: summary.avgDaysInStage
        .filter((s) => !SIDE_STAGES.includes(s.stage) || s.samples > 0)
        .map((s) => ({
          label: STAGE_LABELS[s.stage],
          avgDays: s.avgDays,
          samples: s.samples,
        })),
      ranking: analistas.map((a) => ({
        name: a.name,
        signed: a.signed,
        activeProcesses: a.activeProcesses,
        avgDays: a.avgDays,
      })),
    };
  }

  async export(
    caller: RequestUserFull,
    format: ReportFormat,
    daysParam?: string,
  ) {
    const model = await this.model(caller, daysParam);
    const file = format === 'xlsx' ? reportXlsx(model) : reportPdf(model);
    await this.dataSource.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, metadata)
       VALUES ($1, $2, 'report_exported', $3::jsonb)`,
      [
        caller.tenantId,
        caller.userId,
        JSON.stringify({ format, days: model.days }),
      ],
    );
    return {
      file,
      fileName: `relatorio-${model.to}-${model.days}dias.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
    };
  }
}
