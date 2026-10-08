import { LINEAR_STAGES, type ProcessStage } from '../processes/process.entity';

const ALL_STAGES: ProcessStage[] = [
  ...LINEAR_STAGES,
  'cliente_inativo',
  'credito_recusado',
  'processo_pendencia',
];
// Stages a process leaves (assinatura is the end of the line)
const TIMED_STAGES = ALL_STAGES.filter((s) => s !== 'assinatura');

export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;

export interface SnapshotRow {
  stage: ProcessStage;
  stage_before_pendencia: ProcessStage | null;
  valor: string | number | null;
  created_at: Date | string;
}

export interface HistoryRow {
  action: 'stage_change' | 'stage_change_undo';
  from_state: string | null;
  to_state: string | null;
  days_in_from: string | number | null;
}

export interface DashboardSummary {
  days: number;
  generatedAt: string;
  totals: {
    processes: number;
    unitValue: number;
    averageTicket: number | null;
    withValue: number;
  };
  byStage: { stage: ProcessStage; count: number }[];
  funnel: {
    stage: ProcessStage;
    reached: number;
    pctOfTotal: number;
    stepRate: number | null;
  }[];
  period: {
    newProcesses: number;
    stageChanges: number;
    signed: number;
    entered: { stage: ProcessStage; count: number }[];
  };
  avgDaysInStage: {
    stage: ProcessStage;
    avgDays: number | null;
    samples: number;
  }[];
}

// ?days= comes as text; anything invalid falls back to the default and the
// value is kept between 1 and MAX_DAYS.
export function clampDays(raw?: string): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

const isStage = (s: string | null): s is ProcessStage =>
  !!s && (ALL_STAGES as string[]).includes(s);
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) =>
  whole > 0 ? round1((part / whole) * 100) : 0;

// Same rule as the gestor dashboard (FE-08): the furthest linear stage the
// process is known to have reached. Pendência goes back to where it was
// opened; credit refusal went through credit analysis; inactive only counts
// the first contact.
function reachedIndex(p: SnapshotRow): number {
  const i = LINEAR_STAGES.indexOf(p.stage);
  if (i >= 0) return i;
  if (p.stage === 'processo_pendencia') {
    return LINEAR_STAGES.indexOf(p.stage_before_pendencia ?? 'cadastro');
  }
  if (p.stage === 'credito_recusado') {
    return LINEAR_STAGES.indexOf('analise_credito');
  }
  return 0;
}

// BE-14: dashboard aggregates. Snapshot = the tenant's active processes now;
// period = stage changes recorded in the audit log in the last `days` days.
// Time in a stage = from entering it (previous change, or the creation of the
// process) until leaving it, averaged over the exits in the period.
export function buildSummary(
  days: number,
  snapshot: SnapshotRow[],
  history: HistoryRow[],
  now: Date,
): DashboardSummary {
  const since = now.getTime() - days * 86_400_000;

  const values = snapshot
    .map((p) => Number(p.valor ?? 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const unitValue = values.reduce((a, b) => a + b, 0);

  const reached = snapshot.map(reachedIndex);
  let prev: number | null = null;
  const funnel = LINEAR_STAGES.map((stage, i) => {
    const n = reached.filter((r) => r >= i).length;
    const step = {
      stage,
      reached: n,
      pctOfTotal: pct(n, snapshot.length),
      stepRate: prev === null ? null : pct(n, prev),
    };
    prev = n;
    return step;
  });

  const changes = history.filter((h) => h.action === 'stage_change');
  const entered = new Map<ProcessStage, number>();
  const durations = new Map<ProcessStage, number[]>();
  for (const h of changes) {
    if (isStage(h.to_state)) {
      entered.set(h.to_state, (entered.get(h.to_state) ?? 0) + 1);
    }
    const d = Number(h.days_in_from);
    if (isStage(h.from_state) && Number.isFinite(d) && d >= 0) {
      durations.set(h.from_state, [...(durations.get(h.from_state) ?? []), d]);
    }
  }

  return {
    days,
    generatedAt: now.toISOString(),
    totals: {
      processes: snapshot.length,
      unitValue: round1(unitValue),
      averageTicket: values.length ? round1(unitValue / values.length) : null,
      withValue: values.length,
    },
    byStage: ALL_STAGES.map((stage) => ({
      stage,
      count: snapshot.filter((p) => p.stage === stage).length,
    })),
    funnel,
    period: {
      newProcesses: snapshot.filter(
        (p) => new Date(p.created_at).getTime() >= since,
      ).length,
      stageChanges: changes.length,
      signed: entered.get('assinatura') ?? 0,
      entered: ALL_STAGES.map((stage) => ({
        stage,
        count: entered.get(stage) ?? 0,
      })),
    },
    avgDaysInStage: TIMED_STAGES.map((stage) => {
      const ds = durations.get(stage) ?? [];
      return {
        stage,
        avgDays: ds.length
          ? round1(ds.reduce((a, b) => a + b, 0) / ds.length)
          : null,
        samples: ds.length,
      };
    }),
  };
}
