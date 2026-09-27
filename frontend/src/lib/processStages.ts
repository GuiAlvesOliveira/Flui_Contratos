// Process state machine — mirrors backend/src/processes/process.entity.ts
// (ProcessStage, ALLOWED_TRANSITIONS, allowedTransitions). The API enforces
// these rules; the UI only offers the moves it will accept. Keep both in sync.

export type ProcessStage =
  | 'inicial' | 'cadastro' | 'analise_credito' | 'credito_aprovado'
  | 'analise_juridica' | 'juridico_aprovado' | 'cartorio' | 'assinatura'
  | 'cliente_inativo' | 'credito_recusado' | 'processo_pendencia';

export const STAGE_LABELS: Record<ProcessStage, string> = {
  inicial: 'Primeiro Contato',
  cadastro: 'Cadastro',
  analise_credito: 'Análise de Crédito',
  credito_aprovado: 'Crédito Aprovado',
  analise_juridica: 'Análise Jurídica',
  juridico_aprovado: 'Jurídico Aprovado',
  cartorio: 'Cartório',
  assinatura: 'Assinatura',
  cliente_inativo: 'Inativo',
  credito_recusado: 'Crédito Recusado',
  processo_pendencia: 'Pendência',
};

export const LINEAR_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

const ALLOWED_TRANSITIONS: Record<ProcessStage, ProcessStage[]> = {
  inicial: ['cadastro', 'cliente_inativo'],
  cadastro: ['analise_credito', 'cliente_inativo', 'processo_pendencia'],
  analise_credito: ['credito_aprovado', 'credito_recusado', 'cliente_inativo', 'processo_pendencia'],
  credito_aprovado: ['analise_juridica', 'cliente_inativo', 'processo_pendencia'],
  analise_juridica: ['juridico_aprovado', 'cliente_inativo', 'processo_pendencia'],
  juridico_aprovado: ['cartorio', 'cliente_inativo', 'processo_pendencia'],
  cartorio: ['assinatura', 'cliente_inativo', 'processo_pendencia'],
  assinatura: [],
  cliente_inativo: ['inicial'],
  credito_recusado: ['analise_credito'],
  processo_pendencia: [
    'cadastro', 'analise_credito', 'credito_aprovado', 'analise_juridica',
    'juridico_aprovado', 'cartorio', 'cliente_inativo',
  ],
};

// Targets reachable from `stage`. A process on hold only resumes at (or before)
// the stage it was parked from; legacy holds without one keep the full list.
export function allowedTransitions(
  stage: ProcessStage,
  stageBeforePendencia: ProcessStage | null,
): ProcessStage[] {
  const targets = ALLOWED_TRANSITIONS[stage];
  if (stage !== 'processo_pendencia' || !stageBeforePendencia) return targets;
  const limit = LINEAR_STAGES.indexOf(stageBeforePendencia);
  if (limit < 0) return targets;
  return targets.filter(s => s === 'cliente_inativo' || LINEAR_STAGES.indexOf(s) <= limit);
}
