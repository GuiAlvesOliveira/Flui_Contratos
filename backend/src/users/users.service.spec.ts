import { ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const userRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn() };
  const tenantRepo = { findOne: jest.fn() };
  const supabaseAdmin = { createUser: jest.fn(), generateInviteLink: jest.fn(), deleteUser: jest.fn() };
  const email = { sendInvite: jest.fn() };
  const dataSource = { query: jest.fn() };
  const service = new UsersService(
    userRepo as unknown as Repository<User>,
    tenantRepo as unknown as Repository<Tenant>,
    supabaseAdmin as never,
    email as never,
    dataSource as unknown as DataSource,
  );
  return { service, userRepo, supabaseAdmin, dataSource };
}

const dto = (role: string) => ({ email: 'x@y.com', name: 'X', role } as CreateUserDto);
const caller = (role: string) =>
  ({ role, tenantId: 't1', userId: 'u1' } as RequestUserFull);

describe('UsersService.create — creation hierarchy (privilege-escalation boundary)', () => {
  it('forbids a cliente from creating any user', async () => {
    const { service, userRepo } = makeService();
    await expect(service.create(dto('cliente'), caller('cliente'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(userRepo.create).not.toHaveBeenCalled();
  });

  it('forbids an analista from creating a dono', async () => {
    const { service } = makeService();
    await expect(service.create(dto('dono'), caller('analista'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids an analista from creating another analista', async () => {
    const { service } = makeService();
    await expect(service.create(dto('analista'), caller('analista'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('forbids a dono from creating an admin', async () => {
    const { service } = makeService();
    await expect(service.create(dto('admin'), caller('dono'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('UsersService.create — temporary password (SEC-01)', () => {
  const cpf = '123.456.789-09';
  const setup = () => {
    const ctx = makeService();
    ctx.userRepo.findOne.mockResolvedValue(null);
    ctx.userRepo.create.mockImplementation((u: Partial<User>) => u);
    ctx.userRepo.save.mockImplementation((u: Partial<User>) =>
      Promise.resolve({ ...u, id: 'new-user' }),
    );
    ctx.supabaseAdmin.createUser.mockResolvedValue('ext-1');
    return ctx;
  };
  const create = (service: UsersService) =>
    service.create({ ...dto('analista'), cpf }, caller('dono'));

  it('creates the Supabase user with a random password, never the CPF', async () => {
    const { service, supabaseAdmin } = setup();
    const res = await create(service);

    const [, password] = supabaseAdmin.createUser.mock.calls[0] as [string, string, string];
    expect(password).toMatch(/^[0-9a-f]{32}$/);
    expect(password).not.toContain('12345678909');
    expect(res.temporaryPassword).toBe(password);
  });

  it('generates a different password for every user', async () => {
    const { service, supabaseAdmin } = setup();
    await create(service);
    await create(service);

    const [first, second] = supabaseAdmin.createUser.mock.calls.map((c: string[]) => c[1]);
    expect(first).not.toBe(second);
  });

  it('starts invited and still forces a password change on first login', async () => {
    const { service, userRepo } = setup();
    await create(service);
    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ mustChangePassword: true, status: 'invited' }),
    );
  });
});

describe('UsersService account status (SEC-02)', () => {
  const target = (overrides: Partial<User> = {}) =>
    ({ id: 'u2', tenantId: 't1', role: 'cliente', status: 'active', externalId: 'ext2', ...overrides }) as User;

  it('disables an account through PATCH /users/:id/status', async () => {
    const { service, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue(target());
    await expect(
      service.updateStatus('u2', { status: 'disabled' }, caller('dono')),
    ).resolves.toEqual({ id: 'u2', status: 'disabled' });
    expect(userRepo.update).toHaveBeenCalledWith('u2', { status: 'disabled' });
  });

  it('re-enables a disabled account explicitly', async () => {
    const { service, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue(target({ status: 'disabled' }));
    await service.updateStatus('u2', { status: 'active' }, caller('dono'));
    expect(userRepo.update).toHaveBeenCalledWith('u2', { status: 'active' });
  });

  it('refuses to change the status of a user from another tenant (RN-01)', async () => {
    const { service, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue(target({ tenantId: 'other' }));
    await expect(
      service.updateStatus('u2', { status: 'disabled' }, caller('dono')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.update).not.toHaveBeenCalled();
  });

  it('removing a cliente disables the account', async () => {
    const { service, userRepo, dataSource } = makeService();
    userRepo.findOne.mockResolvedValue(target());
    dataSource.query.mockResolvedValue([{ count: '0' }]);
    await service.remove('u2', caller('dono'));
    expect(userRepo.update).toHaveBeenCalledWith('u2', { status: 'disabled' });
  });
});
