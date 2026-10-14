import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// Names, document labels and notes are typed by users: escaped so they can't
// inject markup (a link, for instance) into an e-mail sent by the platform.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
        // A stuck SMTP server can't hold a message past the outbox lease
        // (BE-09_v2): the send fails and the worker retries it later.
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 60_000,
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

  // The outbox worker (BE-09_v2) only runs when there is a transport to use.
  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendOrThrow(
    to: string,
    subject: string,
    html: string,
    text?: string,
  ): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP não configurado — defina SMTP_HOST, SMTP_USER e SMTP_PASS no .env.local');
    }
    await this.transporter.sendMail({ from: this.from, to, subject, html, text });
  }

  sendInvite(email: string, name: string, inviteLink: string): void {
    const subject = 'Bem-vindo ao Flui Contratos — configure sua senha';
    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#18181b">
        <div style="background:#2563eb;padding:24px 28px;border-radius:8px 8px 0 0">
          <div style="color:#fff;font-size:20px;font-weight:700">Flui Contratos</div>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px">
          <p>Olá, <strong>${escapeHtml(name)}</strong>!</p>
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

  // BE-08: link de recuperação gerado pelo Supabase, enviado pelo SMTP (Brevo)
  sendPasswordReset(
    email: string,
    name: string,
    resetLink: string,
  ): Promise<void> {
    const subject = 'Flui Contratos — redefinição de senha';
    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#18181b">
        <div style="background:#2563eb;padding:24px 28px;border-radius:8px 8px 0 0">
          <div style="color:#fff;font-size:20px;font-weight:700">Flui Contratos</div>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #e4e4e7;border-top:none;border-radius:0 0 8px 8px">
          <p>Olá, <strong>${escapeHtml(name)}</strong>!</p>
          <p>Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova senha:</p>
          <div style="text-align:center;margin:28px 0">
            <a href="${escapeHtml(resetLink)}"
               style="background:#2563eb;color:#fff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block">
              Redefinir minha senha
            </a>
          </div>
          <p style="font-size:13px;color:#71717a">O link vale para um único uso e expira em pouco tempo. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.</p>
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0"/>
          <p style="font-size:12px;color:#a1a1aa">Flui Contratos — não responda este e-mail.</p>
        </div>
      </div>
    `;
    return this.send(email, subject, html);
  }
}
