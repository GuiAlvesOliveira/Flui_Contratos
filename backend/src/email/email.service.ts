import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { ProcessStage } from '../processes/process.entity';

const STAGE_LABELS: Record<ProcessStage, string> = {
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

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<number>('SMTP_PORT', 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.from = this.config.get<string>('SMTP_FROM', 'Flui Contratos <noreply@fluicontratos.com.br>');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`Email SMTP configured — ${host}:${port} (${user})`);
    } else {
      this.transporter = null;
      this.logger.warn('SMTP_HOST/USER/PASS not set — email sending disabled');
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) return;

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
    } catch (err: unknown) {
      this.logger.error(`Email to ${to} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async sendOrThrow(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP não configurado — defina SMTP_HOST, SMTP_USER e SMTP_PASS no .env.local');
    }
    await this.transporter.sendMail({ from: this.from, to, subject, html });
  }

  sendStageChange(
    clientEmail: string,
    clientName: string,
    fromStage: ProcessStage,
    toStage: ProcessStage,
  ): void {
    const fromLabel = STAGE_LABELS[fromStage] ?? fromStage;
    const toLabel = STAGE_LABELS[toStage] ?? toStage;
    const subject = `Flui Contratos — seu processo avançou para ${toLabel}`;
    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#18181b">
        <div style="background:#2563eb;padding:24px 28px;border-radius:8px 8px 0 0">
          <div style="color:#fff;font-size:20px;font-weight:700">Flui Contratos</div>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px">
          <p>Olá, <strong>${clientName}</strong>!</p>
          <p>Seu processo de financiamento avançou de etapa:</p>
          <div style="display:flex;align-items:center;gap:12px;margin:20px 0;padding:16px;background:#f4f4f5;border-radius:6px">
            <span style="font-size:13px;color:#71717a">${fromLabel}</span>
            <span style="color:#2563eb;font-weight:700">→</span>
            <span style="font-size:14px;font-weight:700;color:#2563eb">${toLabel}</span>
          </div>
          <p>Acesse o portal para acompanhar os próximos passos e verificar os documentos necessários.</p>
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0"/>
          <p style="font-size:12px;color:#a1a1aa">Flui Contratos — não responda este e-mail.</p>
        </div>
      </div>
    `;
    this.send(clientEmail, subject, html).catch(() => {/* already logged inside send() */});
  }

  sendDocumentRejected(
    clientEmail: string,
    clientName: string,
    docLabel: string,
    notes: string | null,
  ): void {
    const subject = `Flui Contratos — documento "${docLabel}" precisa ser reenviado`;
    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#18181b">
        <div style="background:#2563eb;padding:24px 28px;border-radius:8px 8px 0 0">
          <div style="color:#fff;font-size:20px;font-weight:700">Flui Contratos</div>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px">
          <p>Olá, <strong>${clientName}</strong>!</p>
          <p>O documento <strong>"${docLabel}"</strong> foi revisado e precisa ser reenviado.</p>
          ${notes ? `<div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:0 4px 4px 0"><strong>Observação do analista:</strong><br/>${notes}</div>` : ''}
          <p>Acesse o portal, faça o upload do documento correto e aguarde a nova validação.</p>
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0"/>
          <p style="font-size:12px;color:#a1a1aa">Flui Contratos — não responda este e-mail.</p>
        </div>
      </div>
    `;
    this.send(clientEmail, subject, html).catch(() => {/* already logged inside send() */});
  }

  sendInvite(email: string, name: string, inviteLink: string): void {
    const subject = 'Bem-vindo ao Flui Contratos — configure sua senha';
    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#18181b">
        <div style="background:#2563eb;padding:24px 28px;border-radius:8px 8px 0 0">
          <div style="color:#fff;font-size:20px;font-weight:700">Flui Contratos</div>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px">
          <p>Olá, <strong>${name}</strong>!</p>
          <p>Sua conta foi criada no <strong>Flui Contratos</strong>. Clique no botão abaixo para definir sua senha e acessar o portal:</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${inviteLink}"
               style="background:#2563eb;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">
              Definir minha senha
            </a>
          </div>
          <p style="font-size:13px;color:#71717a">O link expira em 24 horas. Se você não solicitou este convite, ignore este e-mail.</p>
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0"/>
          <p style="font-size:12px;color:#a1a1aa">Flui Contratos — não responda este e-mail.</p>
        </div>
      </div>
    `;
    this.send(email, subject, html).catch(() => {/* already logged inside send() */});
  }
}
