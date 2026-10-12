import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PasswordResetService } from './password-reset.service';
import { User } from '../users/user.entity';

function makeService(user: Partial<User> | null) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(user),
  };
  const userRepo = { createQueryBuilder: jest.fn(() => qb) };
  const supabaseAdmin = {
    generateRecoveryLink: jest
      .fn()
      .mockResolvedValue('https://supabase.test/verify?token=t&type=recovery'),
  };
  const email = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
  const service = new PasswordResetService(
    userRepo as unknown as Repository<User>,
    supabaseAdmin as never,
    email as never,
  );
  return { service, qb, supabaseAdmin, email };
}

const ana: Partial<User> = {
  email: 'ana@exemplo.dev',
  name: 'Ana',
  status: 'active',
};

describe('PasswordResetService (BE-08)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends the Supabase recovery link through our e-mail', async () => {
    const { service, qb, supabaseAdmin, email } = makeService(ana);
    await service.request('  Ana@Exemplo.dev ');
    expect(qb.where).toHaveBeenCalledWith('LOWER(u.email) = :email', {
      email: 'ana@exemplo.dev',
    });
    expect(supabaseAdmin.generateRecoveryLink).toHaveBeenCalledWith(
      'ana@exemplo.dev',
    );
    expect(email.sendPasswordReset).toHaveBeenCalledWith(
      'ana@exemplo.dev',
      'Ana',
      'https://supabase.test/verify?token=t&type=recovery',
    );
  });

  it.each<[string, Partial<User> | null]>([
    ['an unknown e-mail', null],
    ['a disabled account', { ...ana, status: 'disabled' }],
  ])('sends nothing for %s', async (_label, user) => {
    const { service, supabaseAdmin, email } = makeService(user);
    await service.request('ana@exemplo.dev');
    expect(supabaseAdmin.generateRecoveryLink).not.toHaveBeenCalled();
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('sends at most one e-mail per address per minute', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { service, email } = makeService(ana);
    await service.request('ana@exemplo.dev');
    await service.request('ANA@exemplo.dev');
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + PasswordResetService.COOLDOWN_MS);
    await service.request('ana@exemplo.dev');
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(2);
  });

  it('a Supabase failure is logged, never thrown to the caller', async () => {
    const { service, supabaseAdmin, email } = makeService(ana);
    supabaseAdmin.generateRecoveryLink.mockRejectedValue(new Error('down'));
    await expect(service.request('ana@exemplo.dev')).resolves.toBeUndefined();
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('down'));
  });
});
