import { LINEAR_STAGES, type ProcessStage } from '../processes/process.entity';

export type FormType = 'dps' | 'financiamento';

export const FORM_LABELS: Record<FormType, string> = {
  dps: 'DPS — Declaração Pessoal de Saúde',
  financiamento: 'Formulário de Financiamento',
};

// FE-23: the forms open once the process reached Análise de Crédito (the old
// "em análise no banco" stage was unified into it). A process on hold keeps
// them if it was parked from there on; a refused credit went through it.
export function formsAvailable(
  stage: ProcessStage,
  stageBeforePendencia: ProcessStage | null,
): boolean {
  const from = LINEAR_STAGES.indexOf('analise_credito');
  if (stage === 'credito_recusado') return true;
  if (stage === 'processo_pendencia') {
    return LINEAR_STAGES.indexOf(stageBeforePendencia ?? 'cadastro') >= from;
  }
  return LINEAR_STAGES.indexOf(stage) >= from;
}
