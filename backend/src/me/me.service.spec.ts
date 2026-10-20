import { Repository } from 'typeorm';
import { MeService } from './me.service';
import { User } from '../users/user.entity';
import { RequestUserFull } from '../auth/supabase.guard';
import { UserContextCache } from '../auth/user-context.cache';

function makeService() {
  const userRepo = { update: jest.fn() };
  const supabaseAdmin = { updateUserPassword: jest.fn() };
  const userCache = { invalidateUser: jest.fn() };
  const tempPasswords = { remove: jest.fn() };
  const manager = { query: jest.fn().mockResolvedValue([]) };
  const dataSource = {
    transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
  };
  const service = new MeService(
    userRepo as unknown as Repository<User>,
    supabaseAdmin as never,
    userCache as unknown as UserContextCache,
    tempPasswords as never,
    dataSource as never,
  );
  return { service, userRepo, supabaseAdmin, userCache, tempPasswords, dataSource, manager };
}

const user = { userId: 'u1', externalId: 'ext1', tenantId: 't1', role: 'cliente' } as RequestUserFull;

describe('MeService', () => {
  it('changePassword updates Supabase and clears mustChangePassword (SEC-03)', async () => {
    const { service, userRepo, supabaseAdmin } = makeService();
    await service.changePassword(user, 'nova-senha-123');
    expect(supabaseAdmin.updateUserPassword).toHaveBeenCalledWith('ext1', 'nova-senha-123');
    expect(userRepo.update).toHaveBeenCalledWith('u1', { mustChangePassword: false });
  });

  it('changePassword discards the kept temporary password (BE-18)', async () => {
    const { service, tempPasswords } = makeService();
    await service.changePassword(user, 'nova-senha-123');
    expect(tempPasswords.remove).toHaveBeenCalledWith('u1');
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

  it('completeOnboarding stores the CEP as digits and the address (PROD-06)', async () => {
    const { service, userRepo } = makeService();
    await service.completeOnboarding(user, {
      name: 'João',
      cep: '01310-100',
      endereco: '  Avenida Paulista, 1000, Bela Vista, São Paulo - SP  ',
    });
    expect(userRepo.update).toHaveBeenCalledWith('u1', {
      name: 'João',
      onboardingCompleted: true,
      cep: '01310100',
      endereco: 'Avenida Paulista, 1000, Bela Vista, São Paulo - SP',
    });
  });

  it('completeOnboarding stores the birth date from the ficha (FE-20)', async () => {
    const { service, userRepo } = makeService();
    await service.completeOnboarding(user, {
      name: 'João',
      dataNascimento: '1990-05-17',
    });
    expect(userRepo.update).toHaveBeenCalledWith('u1', {
      name: 'João',
      onboardingCompleted: true,
      dataNascimento: '1990-05-17',
    });
  });

  it('completeOnboarding invalidates the cached context so GET /me sees it (AUTH-09)', async () => {
    const { service, userCache } = makeService();
    await service.completeOnboarding(user, { name: 'João' });
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1');
  });

  it('changePassword invalidates the cached context too (AUTH-09)', async () => {
    const { service, userCache } = makeService();
    await service.changePassword(user, 'nova-senha-123');
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u1');
  });
});

describe('MeService — estado civil e fonte de renda da ficha do cliente', () => {
  it('guarda no cliente e preenche os processos dele que ainda não têm, antes de concluir o onboarding', async () => {
    const { service, userRepo, manager, dataSource } = makeService();
    manager.query.mockResolvedValueOnce([
      { id: 'p1', fields: 'estadoCivil, fonteRenda' },
      { id: 'p2', fields: 'fonteRenda' },
    ]);
    await service.completeOnboarding(user, {
      name: 'Helena',
      estadoCivil: 'uniao_estavel',
      fonteRenda: 'assalariado',
    });
    expect(userRepo.update).toHaveBeenCalledWith('u1', {
      name: 'Helena',
      onboardingCompleted: true,
      estadoCivil: 'uniao_estavel',
      fonteRenda: 'assalariado',
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('COALESCE(p.estado_civil, $1)');
    expect(sql).toContain('COALESCE(p.fonte_renda, $2)');
    expect(sql).toContain('client_id = $3 AND tenant_id = $4 AND active = true');
    expect(params).toEqual(['uniao_estavel', 'assalariado', 'u1', 't1']);
    // um registro no Log de Ações de cada processo preenchido
    const audits = manager.query.mock.calls.slice(1) as [string, unknown[]][];
    expect(audits.map(([q, p]) => [q.includes("'profile_update'"), p[1], p[3]])).toEqual([
      [true, 'p1', JSON.stringify({ fields: 'estadoCivil, fonteRenda' })],
      [true, 'p2', JSON.stringify({ fields: 'fonteRenda' })],
    ]);
    // os processos são preenchidos antes de a ficha ficar concluída
    expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
      userRepo.update.mock.invocationCallOrder[0],
    );
  });

  it('sem estado civil nem fonte de renda, os processos não são tocados', async () => {
    const { service, dataSource } = makeService();
    await service.completeOnboarding(user, { name: 'Helena' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('se o preenchimento falha, o onboarding não é concluído', async () => {
    const { service, userRepo, manager } = makeService();
    manager.query.mockRejectedValueOnce(new Error('banco fora'));
    await expect(
      service.completeOnboarding(user, { name: 'Helena', estadoCivil: 'casado' }),
    ).rejects.toThrow('banco fora');
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('só vale para o cliente: o analista que mandar esses campos não muda processos', async () => {
    const { service, userRepo, dataSource } = makeService();
    const analista = { ...user, role: 'analista' } as RequestUserFull;
    await service.completeOnboarding(analista, { name: 'Ana', estadoCivil: 'casado' });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(userRepo.update).toHaveBeenCalledWith('u1', { name: 'Ana', onboardingCompleted: true });
  });
});
