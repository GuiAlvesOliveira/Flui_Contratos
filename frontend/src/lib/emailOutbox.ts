// Nomes usados na tela "E-mails" do Log de Ações (fila message_outbox).

export type EmailStatus = 'held' | 'pending' | 'sent' | 'failed' | 'cancelled' | 'expired';

// A ordem das situações na tela: primeiro o que depende do gestor.
export const EMAIL_STATUS_ORDER: EmailStatus[] = ['held', 'pending', 'sent', 'failed', 'cancelled', 'expired'];

export const EMAIL_STATUS: Record<
  EmailStatus,
  { label: string; tab: string; color: 'amber' | 'blue' | 'green' | 'red' | 'neutral'; empty: string }
> = {
  held: {
    label: 'Aguardando liberação',
    tab: 'Aguardando liberação',
    color: 'amber',
    empty: 'Nenhum e-mail aguardando a sua liberação.',
  },
  pending: {
    label: 'Na fila de envio',
    tab: 'Na fila',
    color: 'blue',
    empty: 'Nenhum e-mail na fila de envio.',
  },
  sent: {
    label: 'Enviado',
    tab: 'Enviados',
    color: 'green',
    empty: 'Nenhum e-mail enviado nos últimos 30 dias.',
  },
  failed: {
    label: 'Falhou',
    tab: 'Falharam',
    color: 'red',
    empty: 'Nenhum e-mail com falha.',
  },
  cancelled: {
    label: 'Cancelado',
    tab: 'Cancelados',
    color: 'neutral',
    empty: 'Nenhum e-mail cancelado.',
  },
  expired: {
    label: 'Vencido',
    tab: 'Vencidos',
    color: 'neutral',
    empty: 'Nenhum e-mail vencido.',
  },
};

// event_type da mensagem → o que ela avisa
export const EMAIL_EVENT_LABELS: Record<string, string> = {
  documents_requested: 'Pedido de documentos',
  credit_refused: 'Crédito recusado',
  bank_analysis: 'Análise bancária',
  pending_alert: 'Alerta de pendência',
  signature: 'Assinatura do contrato',
  issuance: 'Etapa de emissão',
  stage_changed: 'Mudança de etapa',
  document_rejected: 'Documento recusado',
  process_stalled: 'Processo parado',
  data_requested: 'Pedido de dados',
  invite: 'Convite de acesso',
  password_reset: 'Redefinição de senha',
  test_email: 'Teste de e-mail',
};

export const ROLE_LABELS: Record<string, string> = {
  cliente: 'Cliente',
  analista: 'Analista',
  gestor: 'Gestor',
};
