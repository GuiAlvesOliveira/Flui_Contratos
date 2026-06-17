import { Repository } from 'typeorm';
import { MeService } from './me.service';
import { User } from '../users/user.entity';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const userRepo = { update: jest.fn() };
  const supabaseAdmin = { updateUserPassword: jest.fn() };
  const service = new MeService(
    userRepo as unknown as Repository<User>,
    supabaseAdmin as never,
  );
  return { service, userRepo, supabaseAdmin };
}

const user = { userId: 'u1', externalId: 'ext1', tenantId: 't1', role: 'cliente' } as RequestUserFull;

describe('MeService', () => {
  it('changePassword updates Supabase and clears mustChangePassword (SEC-03)', async () => {
    const { service, userRepo, supabaseAdmin } = makeService();
    await service.changePassword(user, 'nova-senha-123');
    expect(supabaseAdmin.updateUserPassword).toHaveBeenCalledWith('ext1', 'nova-senha-123');
    expect(userRepo.update).toHaveBeenCalledWith('u1', { mustChangePassword: false });
  });

  it('completeOnboarding sets the flag and only the provided optional fields', async () => {
    const { service, userRepo } = makeService();
    const res = await service.completeOnboarding(user, { name: 'João', cpf: '12345678900' });
    expect(res).toEqual({ onboardingCompleted: true });
    expect(userRepo.update).toHaveBeenCalledWith('u1', {
      name: 'João',
      onboardingCompleted: true,
      cpf: '12345678900',
    });
  });
});
