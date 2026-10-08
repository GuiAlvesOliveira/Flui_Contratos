import { STAGE_LABELS } from './processStages';

// Nomes das ações do log de auditoria (RN-07), usados no Log de Ações e na aba
// Atividade do processo. Ações sem nome aparecem com o código original.
export const ACTION_LABELS: Record<string, string> = {
  stage_change: 'Mudança de etapa',
  stage_change_undo: 'Desfez mudança de etapa',
  process_deactivated: 'Processo removido',
  process_reactivated: 'Processo reativado',
  document_upload: 'Envio de documento',
  documents_requested: 'Documentos solicitados',
  document_validated: 'Documento validado',
  document_rejected: 'Documento rejeitado',
  document_deleted: 'Documento excluído (LGPD)',
  profile_update: 'Atualização de cadastro',
};

export const actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

// Etapas antigas, de antes da unificação do fluxo (migration UnifyProcessStages).
// O histórico não é reescrito: os eventos antigos mostram o nome da época.
const LEGACY_STAGE_LABELS: Record<string, string> = {
  cliente_ativo: 'Cliente ativo',
  aprovado: 'Aprovado',
  em_analise_banco: 'Em análise no banco',
  aguardando_assinatura: 'Aguardando assinatura',
  em_emissao: 'Em emissão',
  juridico: 'Jurídico',
  vistoria: 'Vistoria',
  contrato: 'Contrato',
};

// Estados gravados no log: etapas do processo (atuais e antigas), e
// ativo/inativo na remoção e reativação do processo.
const STATE_LABELS: Record<string, string> = {
  ...LEGACY_STAGE_LABELS,
  ...STAGE_LABELS,
  active: 'Ativo',
  inactive: 'Inativo',
};

export const stateLabel = (s: string | null) => (s ? STATE_LABELS[s] ?? s : '—');
