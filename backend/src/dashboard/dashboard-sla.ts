import type { ProcessStage } from '../processes/process.entity';

// PROD-10: prazo de atendimento (SLA). A process is out of the deadline when it
// has been in its current stage for more than SLA_DAYS days. Signed, inactive
// and refused processes are not waiting for the assessoria, so they do not
// count — the same exemption PROD-05_v2 will use for its alerts.
export const SLA_DAYS = 7;
export const SLA_EXEMPT: ProcessStage[] = [
  'assinatura',
  'cliente_inativo',
  'credito_recusado',
];
const OLDEST_LIMIT = 5;

// One active process, with when it entered its current stage (last stage
// change, or its creation when it never moved).
export interface SlaRow {
  id: string;
  stage: ProcessStage;
  analista_id: string | null;
  client_name: string | null;
  client_email: string;
  stage_since: Date | string;
}

export interface SlaSummary {
  days: number;
  tracked: number;
  overdue: number;
  oldest: {
    processId: string;
    clientName: string;
    stage: ProcessStage;
    daysInStage: number;
  }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const daysSince = (from: Date | string, now: Date) =>
  (now.getTime() - new Date(from).getTime()) / 86_400_000;

export function buildSla(rows: SlaRow[], now: Date): SlaSummary {
  const tracked = rows
    .filter((r) => !SLA_EXEMPT.includes(r.stage))
    .map((r) => ({ ...r, days: daysSince(r.stage_since, now) }));
  const late = tracked
    .filter((r) => r.days > SLA_DAYS)
    .sort((a, b) => b.days - a.days);
  return {
    days: SLA_DAYS,
    tracked: tracked.length,
    overdue: late.length,
    oldest: late.slice(0, OLDEST_LIMIT).map((r) => ({
      processId: r.id,
      clientName: r.client_name?.trim() || r.client_email,
      stage: r.stage,
      daysInStage: Math.floor(r.days),
    })),
  };
}

export interface AnalistaRef {
  id: string;
  name: string | null;
  surname: string | null;
  email: string;
  status: string;
}
export interface DocsRow {
  analista_id: string | null;
  to_validate: string | number;
}
// A stage change in the period: how long the process stayed in `from_state`
export interface AnalysisRow {
  analista_id: string | null;
  from_state: string | null;
  days_in_from: string | number | null;
}

export interface AnalistaSla {
  analistaId: string | null;
  name: string;
  activeProcesses: number;
  docsToValidate: number;
  avgDaysCredito: number | null;
  avgDaysJuridico: number | null;
  overdue: number;
}

// PROD-10: one row per analista of the assessoria for the gestor (disabled
// ones only while they still have active processes), plus "Sem analista" when
// some active process has nobody assigned.
export function buildByAnalista(
  analistas: AnalistaRef[],
  slaRows: SlaRow[],
  docs: DocsRow[],
  analysis: AnalysisRow[],
  now: Date,
): AnalistaSla[] {
  const row = (id: string | null, name: string): AnalistaSla => {
    const mine = slaRows.filter((r) => r.analista_id === id);
    const avg = (stage: ProcessStage) => {
      const ds = analysis
        .filter(
          (a) =>
            a.analista_id === id &&
            a.from_state === stage &&
            a.days_in_from !== null, // Number(null) would count as 0 days
        )
        .map((a) => Number(a.days_in_from))
        .filter((d) => Number.isFinite(d) && d >= 0);
      return ds.length
        ? round1(ds.reduce((a, b) => a + b, 0) / ds.length)
        : null;
    };
    return {
      analistaId: id,
      name,
      activeProcesses: mine.length,
      docsToValidate: Number(
        docs.find((d) => d.analista_id === id)?.to_validate ?? 0,
      ),
      avgDaysCredito: avg('analise_credito'),
      avgDaysJuridico: avg('analise_juridica'),
      overdue: buildSla(mine, now).overdue,
    };
  };
  const rows = analistas
    .filter(
      (a) =>
        a.status !== 'disabled' || slaRows.some((r) => r.analista_id === a.id),
    )
    .map((a) =>
      row(a.id, [a.name, a.surname].filter(Boolean).join(' ') || a.email),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (slaRows.some((r) => r.analista_id === null)) {
    rows.push(row(null, 'Sem analista'));
  }
  return rows;
}
