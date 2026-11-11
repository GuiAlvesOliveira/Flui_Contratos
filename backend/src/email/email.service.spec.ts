import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service';

jest.mock('nodemailer');

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string, def?: unknown) =>
      key in values ? values[key] : def,
    ),
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
    await expect(
      service.send('a@b.com', 's', '<p>h</p>'),
    ).resolves.toBeUndefined();
  });

  it('sendOrThrow throws when SMTP is not configured', async () => {
    const service = new EmailService(config({}));
    await expect(
      service.sendOrThrow('a@b.com', 's', '<p>h</p>'),
    ).rejects.toThrow();
  });

  it('sends through nodemailer when SMTP is configured', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(config(SMTP));
    await service.send('a@b.com', 'Assunto', '<p>oi</p>');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', subject: 'Assunto' }),
    );
  });

  it('BE-09_v2: sendOrThrow sends the plain-text part and lets failures surface', async () => {
    const sendMail = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('smtp down'));
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(config(SMTP));
    expect(service.isConfigured).toBe(true);
    await service.sendOrThrow('a@b.com', 'Assunto', '<p>oi</p>', 'oi');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', html: '<p>oi</p>', text: 'oi' }),
    );
    // the outbox worker needs the error to schedule a retry
    await expect(
      service.sendOrThrow('a@b.com', 's', '<p>h</p>'),
    ).rejects.toThrow('smtp down');
  });

  it('BE-09_v2: the SMTP connection has timeouts shorter than the outbox lease', () => {
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: jest.fn(),
    });
    new EmailService(config(SMTP));
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionTimeout: 20_000,
        socketTimeout: 60_000,
      }),
    );
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

  it('BE-08: the name typed by a user cannot inject markup into the invite', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    const service = new EmailService(config(SMTP));
    service.sendInvite('c@b.com', 'Ana <b>', 'https://app/convite');
    await new Promise((r) => setImmediate(r));
    const [[{ html }]] = sendMail.mock.calls as [[{ html: string }]];
    expect(html).toContain('Ana &lt;b&gt;');
    expect(html).not.toContain('Ana <b>');
  });

  // Convite e redefinição de senha saem na hora (o link não pode ficar
  // guardado), mas contam no limite diário e aparecem para o gestor.
  describe('direct sends under the gestor control', () => {
    const ctx = {
      tenantId: 't1',
      recipientRole: 'cliente' as const,
      actorId: 'u1',
    };
    const LINK = 'https://x.supabase.co/auth/v1/verify?token=segredo';

    function direct(
      gate: jest.Mock,
      sendMail = jest.fn().mockResolvedValue({}),
    ) {
      (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
      const service = new EmailService(config(SMTP));
      const seen = jest.fn();
      service.onDirectSend(seen);
      service.setDirectGate(gate);
      return { service, seen, sendMail };
    }

    it('within the limit: the e-mail leaves and the dispatch is reported, without the link', async () => {
      const gate = jest.fn().mockResolvedValue(null);
      const { service, seen, sendMail } = direct(gate);
      await service.sendPasswordReset('ana@exemplo.dev', 'Ana', LINK, ctx);
      expect(gate).toHaveBeenCalledWith(ctx);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenCalledWith({
        ...ctx,
        eventType: 'password_reset',
        to: 'ana@exemplo.dev',
        subject: 'Flui Contratos — redefinição de senha',
        ok: true,
        error: null,
      });
      expect(JSON.stringify(seen.mock.calls)).not.toContain('segredo');
    });

    it('daily limit reached: nothing is sent, and the gestor sees why', async () => {
      const gate = jest
        .fn()
        .mockResolvedValue(
          'Limite diário da assessoria atingido (100 e-mails)',
        );
      const { service, seen, sendMail } = direct(gate);
      service.sendInvite('c@b.com', 'Caio', LINK, ctx);
      await new Promise((r) => setImmediate(r));
      expect(sendMail).not.toHaveBeenCalled();
      expect(seen).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'invite',
          to: 'c@b.com',
          ok: false,
          error: 'Limite diário da assessoria atingido (100 e-mails)',
        }),
      );
    });

    it('the limit cannot be checked: the e-mail does not leave blind', async () => {
      const gate = jest.fn().mockRejectedValue(new Error('db down'));
      const { service, seen, sendMail } = direct(gate);
      await service.sendPasswordReset('ana@exemplo.dev', 'Ana', LINK, ctx);
      expect(sendMail).not.toHaveBeenCalled();
      expect(seen).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it('an SMTP failure is reported as failed, with the reason', async () => {
      const { service, seen } = direct(
        jest.fn().mockResolvedValue(null),
        jest.fn().mockRejectedValue(new Error('smtp down')),
      );
      await service.sendPasswordReset('ana@exemplo.dev', 'Ana', LINK, ctx);
      expect(seen).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: 'smtp down' }),
      );
    });

    it('a failure recording the dispatch does not break the caller', async () => {
      const { service, seen } = direct(jest.fn().mockResolvedValue(null));
      seen.mockImplementation(() => {
        throw new Error('listener quebrou');
      });
      await expect(
        service.sendPasswordReset('ana@exemplo.dev', 'Ana', LINK, ctx),
      ).resolves.toBeUndefined();
    });
  });
});
