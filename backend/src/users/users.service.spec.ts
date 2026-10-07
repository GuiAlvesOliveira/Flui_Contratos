import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { RequestUserFull } from '../auth/supabase.guard';
import { UserContextCache } from '../auth/user-context.cache';

function makeService() {
  const userRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const tenantRepo = { findOne: jest.fn() };
  const supabaseAdmin = {
    createUser: jest.fn(),
    generateInviteLink: jest.fn(),
    deleteUser: jest.fn(),
  };
  const email = { sendInvite: jest.fn() };
  const dataSource = { query: jest.fn() };
  const userCache = { invalidateUser: jest.fn() };
  const service = new UsersService(
    userRepo as unknown as Repository<User>,
    tenantRepo as unknown as Repository<Tenant>,
    supabaseAdmin as never,
    email as never,
    dataSource as unknown as DataSource,
    userCache as unknown as UserContextCache,
  );
  return {
    service,
    userRepo,
    tenantRepo,
    supabaseAdmin,
    dataSource,
    userCache,
  };
}

const dto = (role: string) =>
  ({ email: 'x@y.com', name: 'X', role }) as CreateUserDto;
const caller = (role: string) =>
  ({ role, tenantId: 't1', userId: 'u1' }) as RequestUserFull;

type Role = 'admin' | 'dono' | 'analista' | 'cliente';
const ROLES: Role[] = ['admin', 'dono', 'analista', 'cliente'];
// Who may create whom (QA-05) — every other creator × target pair is refused.
const ALLOWED: [Role, Role][] = [
  ['admin', 'dono'],
  ['dono', 'analista'],
  ['dono', 'cliente'],
  ['analista', 'cliente'],
];
const FORBIDDEN: [Role, Role][] = ROLES.flatMap((creator) =>
  ROLES.map((target): [Role, Role] => [creator, target]),
).filter(([c, t]) => !ALLOWED.some(([ac, at]) => ac === c && at === t));

function creationSetup() {
  const ctx = makeService();
  ctx.userRepo.findOne.mockResolvedValue(null);
  ctx.userRepo.create.mockImplementation((u: Partial<User>) => u);
  ctx.userRepo.save.mockImplementation((u: Partial<User>) =>
    Promise.resolve({ ...u, id: 'new-user' }),
  );
  ctx.supabaseAdmin.createUser.mockResolvedValue('ext-new');
  ctx.supabaseAdmin.generateInviteLink.mockResolvedValue({
    externalId: 'ext-new',
    inviteLink: 'https://invite',
  });
  ctx.tenantRepo.findOne.mockResolvedValue({ id: 'tenant-x' });
  return ctx;
}

const newUser = (role: Role, extra: Partial<CreateUserDto> = {}) =>
  ({
    email: 'novo@y.com',
    name: 'Novo',
    role,
    cpf: '123.456.789-09',
    ...extra,
  }) as CreateUserDto;

describe('UsersService.create — creation hierarchy (QA-05)', () => {
  it('covers every creator × target pair', () => {
    expect(ALLOWED.length + FORBIDDEN.length).toBe(ROLES.length * ROLES.length);
  });

  it.each(FORBIDDEN)(
    'forbids a %s from creating a %s',
    async (creator, target) => {
      const { service, userRepo, supabaseAdmin } = creationSetup();
      await expect(
        service.create(
          newUser(target, { tenantId: 'tenant-x' }),
          caller(creator),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(supabaseAdmin.createUser).not.toHaveBeenCalled();
      expect(supabaseAdmin.generateInviteLink).not.toHaveBeenCalled();
    },
  );

  it.each(ALLOWED)('allows a %s to create a %s', async (creator, target) => {
    const { service, userRepo } = creationSetup();
    await expect(
      service.create(
        newUser(target, { tenantId: 'tenant-x' }),
        caller(creator),
      ),
    ).resolves.toMatchObject({ role: target });
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ role: target }),
    );
  });

  it("creates users in the caller's tenant, ignoring a tenantId sent by a dono (RN-01)", async () => {
    const { service, userRepo } = creationSetup();
    await service.create(
      newUser('analista', { tenantId: 'outro-tenant' }),
      caller('dono'),
    );
    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
    );
  });

  it('an admin creates the dono in the tenant it names', async () => {
    const { service, userRepo } = creationSetup();
    await service.create(
      newUser('dono', { tenantId: 'tenant-x' }),
      caller('admin'),
    );
    expect(userRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-x', role: 'dono' }),
    );
  });

  it('an admin must name an existing tenant for a new dono', async () => {
    const { service, tenantRepo } = creationSetup();
    await expect(
      service.create(newUser('dono'), caller('admin')),
    ).rejects.toBeInstanceOf(BadRequestException);
    tenantRepo.findOne.mockResolvedValue(null);
    await expect(
      service.create(
        newUser('dono', { tenantId: 'nao-existe' }),
        caller('admin'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
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

    const [, password] = supabaseAdmin.createUser.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(password).toMatch(/^[0-9a-f]{32}$/);
    expect(password).not.toContain('12345678909');
    expect(res.temporaryPassword).toBe(password);
  });

  it('generates a different password for every user', async () => {
    const { service, supabaseAdmin } = setup();
    await create(service);
    await create(service);

    const [first, second] = supabaseAdmin.createUser.mock.calls.map(
      (c: string[]) => c[1],
    );
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
    ({
      id: 'u2',
      tenantId: 't1',
      role: 'cliente',
      status: 'active',
      externalId: 'ext2',
      ...overrides,
    }) as User;

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

describe('UsersService.updateProfile — ficha cadastral (FE-20)', () => {
  const cliente = () =>
    ({ id: 'u2', tenantId: 't1', role: 'cliente', status: 'active' }) as User;

  it('saves RG and birth date and logs the changed fields on the process', async () => {
    const { service, userRepo, dataSource } = makeService();
    userRepo.findOne.mockResolvedValue(cliente());
    userRepo.save.mockImplementation((u: User) => Promise.resolve(u));
    await service.updateProfile(
      'u2',
      { rg: '123456789', dataNascimento: '1990-05-17', processId: 'p1' },
      caller('analista'),
    );
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        rg: '123456789',
        dataNascimento: '1990-05-17',
      }),
    );
    const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe(JSON.stringify({ fields: 'rg, dataNascimento' }));
  });

  it('clears the birth date with null', async () => {
    const { service, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue({
      ...cliente(),
      dataNascimento: '1990-05-17',
    });
    userRepo.save.mockImplementation((u: User) => Promise.resolve(u));
    await service.updateProfile('u2', { dataNascimento: null }, caller('dono'));
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ dataNascimento: null }),
    );
  });

  it('a cliente cannot edit another user profile', async () => {
    const { service, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue(cliente());
    await expect(
      service.updateProfile('u2', { rg: '1' }, caller('cliente')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(userRepo.save).not.toHaveBeenCalled();
  });
});

describe('UsersService.updateProfile — only sent fields (RN-07)', () => {
  it('ignores optional fields the DTO declares but the request did not send', async () => {
    const { service, userRepo, dataSource } = makeService();
    const stored: Partial<User> = {
      id: 'u2',
      tenantId: 't1',
      role: 'cliente',
      name: 'Helena',
      cpf: '52998224725',
    };
    userRepo.findOne.mockResolvedValue(stored);
    userRepo.save.mockImplementation((u: User) => Promise.resolve(u));
    // Shape of a ValidationPipe instance: undeclared keys present as undefined
    const dto = { name: undefined, cpf: undefined, rg: '1', processId: 'p1' };
    const res = await service.updateProfile('u2', dto, caller('dono'));
    expect(res).toMatchObject({ name: 'Helena', cpf: '52998224725', rg: '1' });
    const [, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe(JSON.stringify({ fields: 'rg' }));
  });
});

describe('UsersService invalidates the TenantGuard cache (AUTH-09)', () => {
  const target = {
    id: 'u2',
    tenantId: 't1',
    role: 'cliente',
    status: 'active',
  };

  it('on PATCH /users/:id/status (disable/enable)', async () => {
    const { service, userRepo, userCache } = makeService();
    userRepo.findOne.mockResolvedValue({ ...target });
    await service.updateStatus('u2', { status: 'disabled' }, caller('dono'));
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u2');
  });

  it('when a cliente is removed (account disabled)', async () => {
    const { service, userRepo, dataSource, userCache } = makeService();
    userRepo.findOne.mockResolvedValue({ ...target });
    dataSource.query.mockResolvedValue([{ count: '0' }]);
    await service.remove('u2', caller('dono'));
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u2');
  });

  it('on a profile update', async () => {
    const { service, userRepo, userCache } = makeService();
    userRepo.findOne.mockResolvedValue({ ...target });
    userRepo.save.mockImplementation((u: User) => Promise.resolve(u));
    await service.updateProfile('u2', { name: 'Novo' }, caller('dono'));
    expect(userCache.invalidateUser).toHaveBeenCalledWith('u2');
  });

  it('not when the change is refused', async () => {
    const { service, userRepo, userCache } = makeService();
    userRepo.findOne.mockResolvedValue({ ...target, tenantId: 'other' });
    await expect(
      service.updateStatus('u2', { status: 'disabled' }, caller('dono')),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(userCache.invalidateUser).not.toHaveBeenCalled();
  });
});
