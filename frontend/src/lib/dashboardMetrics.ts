// Indicadores do dashboard do gestor (FE-08), calculados a partir de GET /processes.
// A API não guarda o histórico de etapas na listagem, então a conversão usa a
// posição atual de cada processo: quem está numa etapa passou por todas as
// anteriores do caminho linear.

import { LINEAR_STAGES, type ProcessStage } from './processStages';

export interface MetricProcess {
  stage: ProcessStage;
  stageBeforePendencia?: ProcessStage | null;
  valorUnidade: number | string | null;
  unidade?: { empreendimentoId: string; valor: number | string | null } | null;
}

export interface FunnelStep {
  stage: ProcessStage;
  reached: number;
  pctOfTotal: number; // 0–100, sobre todos os processos
  stepRate: number | null; // 0–100, sobre quem chegou à etapa anterior
}

export interface TicketByEmpreendimento {
  empreendimentoId: string;
  count: number;
  average: number;
}

const idx = (s: ProcessStage) => LINEAR_STAGES.indexOf(s);

// Etapa linear mais avançada que o processo comprovadamente alcançou.
// Pendência volta para a etapa em que foi aberta; recusa de crédito passou pela
// análise de crédito; inativo não diz onde parou e conta só o primeiro contato.
export function reachedIndex(p: MetricProcess): number {
  const i = idx(p.stage);
  if (i >= 0) return i;
  if (p.stage === 'processo_pendencia') return idx(p.stageBeforePendencia ?? 'cadastro');
  if (p.stage === 'credito_recusado') return idx('analise_credito');
  return 0;
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export function funnel(processes: MetricProcess[]): FunnelStep[] {
  const reached = processes.map(reachedIndex);
  let prev: number | null = null;
  return LINEAR_STAGES.map((stage, i) => {
    const n = reached.filter(r => r >= i).length;
    const step: FunnelStep = {
      stage,
      reached: n,
      pctOfTotal: pct(n, processes.length),
      stepRate: prev === null ? null : prev > 0 ? pct(n, prev) : 0,
    };
    prev = n;
    return step;
  });
}

export interface ConversionSummary {
  creditApprovalRate: number | null; // aprovados / (aprovados + recusados)
  signedRate: number; // assinados / total
  lossRate: number; // inativos / total
}

export function conversionSummary(processes: MetricProcess[]): ConversionSummary {
  const approved = processes.filter(p => reachedIndex(p) >= idx('credito_aprovado')).length;
  const refused = processes.filter(p => p.stage === 'credito_recusado').length;
  const decided = approved + refused;
  return {
    creditApprovalRate: decided > 0 ? pct(approved, decided) : null,
    signedRate: pct(processes.filter(p => p.stage === 'assinatura').length, processes.length),
    lossRate: pct(processes.filter(p => p.stage === 'cliente_inativo').length, processes.length),
  };
}

// Valor da unidade negociada no processo; sem ele, o valor cadastrado na unidade.
function unitValue(p: MetricProcess): number {
  const v = Number(p.valorUnidade ?? p.unidade?.valor ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Ticket médio por unidade: média do valor das unidades dos processos em
// carteira (inativos fora), ignorando processos sem valor informado.
export function averageTicket(processes: MetricProcess[]): { average: number; count: number } {
  const values = processes.filter(p => p.stage !== 'cliente_inativo').map(unitValue).filter(v => v > 0);
  const sum = values.reduce((a, b) => a + b, 0);
  return { average: values.length ? sum / values.length : 0, count: values.length };
}

export function ticketByEmpreendimento(processes: MetricProcess[]): TicketByEmpreendimento[] {
  const groups = new Map<string, number[]>();
  for (const p of processes) {
    const empId = p.unidade?.empreendimentoId;
    const v = unitValue(p);
    if (!empId || v === 0 || p.stage === 'cliente_inativo') continue;
    groups.set(empId, [...(groups.get(empId) ?? []), v]);
  }
  return [...groups.entries()]
    .map(([empreendimentoId, vs]) => ({
      empreendimentoId,
      count: vs.length,
      average: vs.reduce((a, b) => a + b, 0) / vs.length,
    }))
    .sort((a, b) => b.average - a.average);
}
