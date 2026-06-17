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
});
