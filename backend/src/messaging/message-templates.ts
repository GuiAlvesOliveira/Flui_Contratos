import { escapeHtml } from '../email/email.service';
import type { ProcessStage } from '../processes/process.entity';

// BE-15_v2: the six points of fluxo_processo.md, plus the generic stage change
// and the document rejection. Kept as the `event_type` of each queued message.
export type MessageEvent =
  | 'documents_requested'
  | 'credit_refused'
  | 'bank_analysis'
  | 'pending_alert'
  | 'signature'
  | 'issuance'
  | 'stage_changed'
  | 'document_rejected'
  | 'process_stalled';

export type RecipientRole = 'cliente' | 'analista' | 'gestor';

export interface Recipient {
  name: string | null;
  email: string;
}

export interface OutboundMessage {
  eventType: MessageEvent;
  recipientRole: RecipientRole;
  to: string;
  subject: string;
  html: string;
  text: string;
}

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

const STAGE_EVENTS: Partial<Record<ProcessStage, MessageEvent>> = {
  credito_recusado: 'credit_refused',
  analise_credito: 'bank_analysis',
  credito_aprovado: 'bank_analysis',
  processo_pendencia: 'pending_alert',
  assinatura: 'signature',
  analise_juridica: 'issuance',
  juridico_aprovado: 'issuance',
  cartorio: 'issuance',
};

export function stageEventType(toStage: ProcessStage): MessageEvent {
  return STAGE_EVENTS[toStage] ?? 'stage_changed';
}

const label = (stage: ProcessStage) => STAGE_LABELS[stage] ?? stage;

// ── Rendering ────────────────────────────────────────────────────────────────

// One description of the content renders both the HTML and the plain-text part,
// so the two never drift apart. Every string here is plain text: it is escaped
// when it goes into the HTML (names, labels and notes are typed by users).
interface Content {
  name: string | null;
  paragraphs: string[];
  list?: string[];
  note?: { title: string; body: string };
  cta: string;
  footer: string;
}

interface Context {
  tenantName: string;
  portalUrl: string;
}

function render(content: Content, portalUrl: string) {
  const greeting = `Olá, ${content.name || 'cliente'}!`;
  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#18181b">
  <div style="background:#2563eb;padding:24px 28px;border-radius:8px 8px 0 0">
    <div style="color:#fff;font-size:20px;font-weight:700">Flui Contratos</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px">
    <p>Olá, <strong>${escapeHtml(content.name || 'cliente')}</strong>!</p>
    ${content.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n    ')}
    ${
      content.list?.length
        ? `<ul style="margin:16px 0;padding-left:20px">${content.list
            .map((i) => `<li style="margin:4px 0">${escapeHtml(i)}</li>`)
            .join('')}</ul>`
        : ''
    }
    ${
      content.note
        ? `<div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:0 4px 4px 0"><strong>${escapeHtml(content.note.title)}</strong><br/>${escapeHtml(content.note.body)}</div>`
        : ''
    }
    <div style="text-align:center;margin:28px 0">
      <a href="${escapeHtml(portalUrl)}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(content.cta)}</a>
    </div>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0"/>
    <p style="font-size:12px;color:#a1a1aa">${escapeHtml(content.footer)}</p>
  </div>
</div>`.trim();

  const text = [
    greeting,
    ...content.paragraphs,
    ...(content.list?.length
      ? [content.list.map((i) => `• ${i}`).join('\n')]
      : []),
    ...(content.note ? [`${content.note.title}\n${content.note.body}`] : []),
    `${content.cta}: ${portalUrl}`,
    content.footer,
  ].join('\n\n');

  return { html, text };
}

function clientFooter(ctx: Context): string {
  return `${ctx.tenantName} acompanha o seu financiamento pelo Flui Contratos. Mensagem automática, não responda.`;
}

function toClient(
  eventType: MessageEvent,
  client: Recipient,
  subject: string,
  content: Omit<Content, 'name' | 'cta' | 'footer'>,
  ctx: Context,
): OutboundMessage {
  return {
    eventType,
    recipientRole: 'cliente',
    to: client.email,
    subject: `Flui Contratos — ${subject}`,
    ...render(
      {
        ...content,
        name: client.name,
        cta: 'Acompanhar no portal',
        footer: clientFooter(ctx),
      },
      ctx.portalUrl,
    ),
  };
}

// ── Stage change (RN-08_v2, BE-15_v2) ────────────────────────────────────────

const ISSUANCE_TEXT: Partial<Record<ProcessStage, string>> = {
  analise_juridica:
    'Seu processo entrou na análise jurídica, etapa que prepara a emissão do contrato.',
  juridico_aprovado:
    'A análise jurídica foi aprovada e o contrato vai ser emitido.',
  cartorio: 'O contrato foi enviado para registro no cartório.',
};

function clientStageMessage(
  eventType: MessageEvent,
  fromStage: ProcessStage,
  toStage: ProcessStage,
): { subject: string; text: string } {
  switch (eventType) {
    case 'credit_refused':
      return {
        subject: 'resultado da análise de crédito',
        text: 'A análise de crédito do seu financiamento não foi aprovada pelo banco. Sua assessoria vai entrar em contato para explicar as alternativas.',
      };
    case 'bank_analysis':
      return toStage === 'credito_aprovado'
        ? {
            subject: 'crédito aprovado',
            text: 'Boa notícia: o crédito do seu financiamento foi aprovado pelo banco!',
          }
        : {
            subject: 'seu processo está em análise no banco',
            text: 'Seu processo entrou em Análise de Crédito: a documentação foi enviada ao banco.',
          };
    case 'pending_alert':
      return {
        subject: 'pendência no seu processo',
        text: 'Há uma pendência no seu processo de financiamento. Acesse o portal para ver o que falta e enviar o que for pedido.',
      };
    case 'signature':
      return {
        subject: 'contrato pronto para assinatura',
        text: 'Seu contrato está pronto para assinatura. A assessoria vai orientar o agendamento.',
      };
    case 'issuance':
      return {
        subject: label(toStage),
        text:
          ISSUANCE_TEXT[toStage] ??
          `Seu processo está na etapa ${label(toStage)}.`,
      };
    default:
      return toStage === 'cliente_inativo'
        ? {
            subject: 'seu processo foi marcado como inativo',
            text: 'Sua assessoria marcou o seu processo como inativo. Se tiver dúvidas, fale com ela.',
          }
        : {
            subject: `seu processo está em ${label(toStage)}`,
            text: `Seu processo foi atualizado: saiu de ${label(fromStage)} e agora está na etapa ${label(toStage)}.`,
          };
  }
}

export interface StageChangeInput {
  client: Recipient | null;
  analista: Recipient | null;
  clientName: string | null;
  fromStage: ProcessStage;
  toStage: ProcessStage;
  undo?: boolean;
}

/**
 * Messages for one stage change: always the client; on a pendência also the
 * analista of the process (RN-10, "disparo duplo"). An undo in the Log de Ações
 * is a stage change too and tells the client the process went back.
 */
export function stageChangeMessages(
  input: StageChangeInput,
  ctx: Context,
): OutboundMessage[] {
  const eventType = stageEventType(input.toStage);
  const out: OutboundMessage[] = [];

  if (input.client?.email) {
    const { subject, text } = input.undo
      ? {
          subject: `seu processo voltou para ${label(input.toStage)}`,
          text: `Seu processo voltou para a etapa ${label(input.toStage)} (correção feita pela assessoria).`,
        }
      : clientStageMessage(eventType, input.fromStage, input.toStage);
    out.push(
      toClient(eventType, input.client, subject, { paragraphs: [text] }, ctx),
    );
  }

  if (eventType === 'pending_alert' && input.analista?.email) {
    const clientName = input.clientName || 'cliente';
    out.push({
      eventType,
      recipientRole: 'analista',
      to: input.analista.email,
      subject: `Flui — pendência no processo de ${clientName}`,
      ...render(
        {
          name: input.analista.name || 'analista',
          paragraphs: [
            `O processo de ${clientName} foi para Pendência (etapa anterior: ${label(input.fromStage)}).`,
            'O cliente também foi avisado por e-mail.',
          ],
          cta: 'Abrir o Flui',
          footer: `Mensagem automática do Flui Contratos para a equipe de ${ctx.tenantName}, não responda.`,
        },
        ctx.portalUrl,
      ),
    });
  }
  return out;
}

// ── Documents ────────────────────────────────────────────────────────────────

export function documentsRequestedMessage(
  client: Recipient,
  labels: string[],
  ctx: Context,
): OutboundMessage {
  return toClient(
    'documents_requested',
    client,
    'documentos solicitados',
    {
      paragraphs: [
        'Sua assessoria pediu os documentos abaixo. Envie pelo portal:',
      ],
      list: labels,
    },
    ctx,
  );
}

export function documentRejectedMessage(
  client: Recipient,
  docLabel: string,
  notes: string | null,
  ctx: Context,
): OutboundMessage {
  return toClient(
    'document_rejected',
    client,
    `documento "${docLabel}" precisa ser reenviado`,
    {
      paragraphs: [
        `O documento "${docLabel}" foi revisado e precisa ser reenviado.`,
        'Acesse o portal, envie o documento correto e aguarde a nova validação.',
      ],
      ...(notes
        ? { note: { title: 'Observação do analista:', body: notes } }
        : {}),
    },
    ctx,
  );
}

// ── Processo parado (PROD-05_v2) ─────────────────────────────────────────────

export interface StalledInput {
  clientName: string | null;
  stage: ProcessStage;
  days: number; // dias inteiros na etapa atual
  since: Date;
  limitDays: number;
  // analista: o responsável recebe; sem_analista / analista_desativado: os gestores
  reason: 'analista' | 'sem_analista' | 'analista_desativado';
  analistaName: string | null;
  recipients: { person: Recipient; role: 'analista' | 'gestor' }[];
}

/**
 * Alerta interno da assessoria: o processo está há mais de `limitDays` dias na
 * mesma etapa. Vai para o analista responsável; sem analista ativo, para os
 * gestores (com o motivo). O cliente nunca recebe este e-mail.
 */
export function processStalledMessages(
  input: StalledInput,
  ctx: Context,
): OutboundMessage[] {
  const clientName = input.clientName || 'cliente';
  const since = input.since.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
  const fact = `O processo de ${clientName} está na etapa ${label(input.stage)} há ${input.days} dias (desde ${since}), acima do prazo de ${input.limitDays} dias.`;
  return input.recipients.map(({ person, role }) => {
    const paragraphs =
      role === 'analista'
        ? [
            fact,
            'Confira o que falta para o processo avançar e registre o andamento no Histórico de Atividades.',
          ]
        : [
            fact,
            input.reason === 'analista_desativado'
              ? `O analista responsável${input.analistaName ? ` (${input.analistaName})` : ''} está desativado: reatribua o processo a alguém da equipe.`
              : 'O processo não tem analista responsável: defina um responsável no Flui.',
          ];
    return {
      eventType: 'process_stalled' as const,
      recipientRole: role,
      to: person.email,
      subject: `Flui — processo parado há ${input.days} dias: ${clientName}`,
      ...render(
        {
          name: person.name || (role === 'gestor' ? 'gestor' : 'analista'),
          paragraphs,
          cta: 'Abrir o Flui',
          footer: `Alerta automático do Flui Contratos para a equipe de ${ctx.tenantName}, enviado no máximo uma vez a cada ${input.limitDays} dias por processo. Não responda.`,
        },
        ctx.portalUrl,
      ),
    };
  });
}
