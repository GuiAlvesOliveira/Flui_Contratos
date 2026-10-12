import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer');

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string, def?: unknown) => (key in values ? values[key] : def)),
  } as unknown as ConfigService;
}

const SMTP = { SMTP_HOST: 'smtp.test', SMTP_USER: 'u', SMTP_PASS: 'p' };

describe('EmailService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('disables sending when SMTP is not configured (send is a silent no-op)', async () => {
    const service = new EmailService(config({}));
    await expect(service.send('a@b.com', 's', '<p>h</p>')).resolves.toBeUndefined();
  });

  it('sendOrThrow throws when SMTP is not configured', async () => {
    const service = new EmailService(config({}));
    await expect(service.sendOrThrow('a@b.com', 's', '<p>h</p>')).rejects.toThrow();
  });

  it('sends through nodemailer when SMTP is configured', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(config(SMTP));
    await service.send('a@b.com', 'Assunto', '<p>oi</p>');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.com', subject: 'Assunto' }));
  });

  it('sendStageChange never throws even if the transport rejects', () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('smtp down'));
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(config(SMTP));
    expect(() => service.sendStageChange('a@b.com', 'Ana', 'cadastro', 'analise_credito')).not.toThrow();
  });

  it('BE-08: the reset e-mail carries the recovery link', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(config(SMTP));
    await service.sendPasswordReset(
      'ana@exemplo.dev',
      'Ana',
      'https://x.supabase.co/auth/v1/verify?token=abc&type=recovery',
    );
    const [[mail]] = sendMail.mock.calls as [
      [{ to: string; subject: string; html: string }],
    ];
    expect(mail.to).toBe('ana@exemplo.dev');
    expect(mail.subject).toBe('Flui Contratos — redefinição de senha');
    expect(mail.html).toContain(
      'href="https://x.supabase.co/auth/v1/verify?token=abc&amp;type=recovery"',
    );
    expect(mail.html).toContain('Olá, <strong>Ana</strong>');
  });

  it('BE-08: text typed by users cannot inject markup into the e-mails', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(config(SMTP));
    service.sendDocumentRejected(
      'c@b.com',
      'Ana <b>',
      'RG "frente"',
      '<a href="https://golpe.example">clique aqui</a>',
    );
    await new Promise((r) => setImmediate(r));
    const [[{ html }]] = sendMail.mock.calls as [[{ html: string }]];
    expect(html).not.toContain('<a href="https://golpe.example">');
    expect(html).toContain(
      '&lt;a href=&quot;https://golpe.example&quot;&gt;clique aqui&lt;/a&gt;',
    );
    expect(html).toContain('Ana &lt;b&gt;');
    expect(html).toContain('RG &quot;frente&quot;');
  });
});
