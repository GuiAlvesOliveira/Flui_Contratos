import {
  BadRequestException,
  ConflictException,
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
import { TemporaryPasswordStore } from '../common/services/temporary-password.store';

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
    updateUserPassword: jest.fn(),
  };
  const email = { sendInvite: jest.fn() };
  const dataSource = { query: jest.fn() };
  const userCache = { invalidateUser: jest.fn() };
  const tempPasswords = {
    save: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new UsersService(
    userRepo as unknown as Repository<User>,
    tenantRepo as unknown as Repository<Tenant>,
    supabaseAdmin as never,
    email as never,
    dataSource as unknown as DataSource,
    userCache as unknown as UserContextCache,
    tempPasswords as unknown as TemporaryPasswordStore,
  );
  return {
    service,
    userRepo,
    tenantRepo,
    supabaseAdmin,
    dataSource,
    userCache,
    tempPasswords,
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
    dataSource.query.mockResolvedValueOnce([{ id: 'p1' }]);
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
    const [, params] = dataSource.query.mock.calls[1] as [string, unknown[]];
    expect(params[3]).toBe(JSON.stringify({ fields: 'rg, dataNascimento' }));
  });

  it('RN-01: refuses a processId of another tenant or client and saves nothing', async () => {
    const { service, userRepo, dataSource } = makeService();
    userRepo.findOne.mockResolvedValue(cliente());
    dataSource.query.mockResolvedValueOnce([]);
    await expect(
      service.updateProfile(
        'u2',
        { rg: '1', processId: 'p-outro' },
        caller('dono'),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id = $2 AND client_id = $3');
    expect(params).toEqual(['p-outro', 't1', 'u2']);
    expect(dataSource.query).toHaveBeenCalledTimes(1); // no audit insert
    expect(userRepo.save).not.toHaveBeenCalled();
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
    dataSource.query.mockResolvedValueOnce([{ id: 'p1' }]);
    const res = await service.updateProfile('u2', dto, caller('dono'));
    expect(res).toMatchObject({ name: 'Helena', cpf: '52998224725', rg: '1' });
    const [, params] = dataSource.query.mock.calls[1] as [string, unknown[]];
    expect(params[3]).toBe(JSON.stringify({ fields: 'rg' }));
  });
});

describe('UsersService.updateProfile — CEP e endereço (PROD-06)', () => {
  it('stores the CEP as digits, keeps the address and returns both', async () => {
    const { service, userRepo, dataSource } = makeService();
    userRepo.findOne.mockResolvedValue({
      id: 'u2',
      tenantId: 't1',
      role: 'cliente',
      name: 'Helena',
    });
    userRepo.save.mockImplementation((u: User) => Promise.resolve(u));
    dataSource.query.mockResolvedValueOnce([{ id: 'p1' }]);
    const res = await service.updateProfile(
      'u2',
      { cep: '01310-100', endereco: 'Avenida Paulista, 1000', processId: 'p1' },
      caller('analista'),
    );
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        cep: '01310100',
        endereco: 'Avenida Paulista, 1000',
      }),
    );
    expect(res).toMatchObject({
      cep: '01310100',
      endereco: 'Avenida Paulista, 1000',
    });
    const [, params] = dataSource.query.mock.calls[1] as [string, unknown[]];
    expect(params[3]).toBe(JSON.stringify({ fields: 'cep, endereco' }));
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

describe('UsersService.importCsv (BE-01)', () => {
  const csv = (...lines: string[]) =>
    Buffer.from(['nome;email;cpf;perfil', ...lines].join('\r\n'), 'utf-8');

  function setup() {
    const ctx = makeService();
    ctx.userRepo.findOne.mockImplementation(
      ({ where }: { where: { email?: string } }) =>
        Promise.resolve(
          where.email === 'carla@exemplo.dev' ? { id: 'existente' } : null,
        ),
    );
    ctx.userRepo.create.mockImplementation((u: object) => u);
    ctx.userRepo.save.mockImplementation((u: { email: string }) =>
      Promise.resolve({ ...u, id: `id-${u.email}` }),
    );
    ctx.supabaseAdmin.createUser.mockResolvedValue('ext-novo');
    ctx.dataSource.query.mockResolvedValue([]);
    return ctx;
  }

  it('creates each valid line through create() and reports the others', async () => {
    const { service, supabaseAdmin, dataSource } = setup();
    const res = await service.importCsv(
      csv(
        'Ana;ana@exemplo.dev;52998224725;analista',
        'Bruno;bruno@;52998224725;cliente',
        'Carla;carla@exemplo.dev;52998224725;cliente',
      ),
      caller('dono'),
    );
    expect(res).toMatchObject({ total: 3, created: 1, failed: 2 });
    expect(res.results).toEqual([
      expect.objectContaining({
        line: 2,
        email: 'ana@exemplo.dev',
        success: true,
      }),
      expect.objectContaining({
        line: 3,
        success: false,
        error: 'E-mail inválido',
      }),
      expect.objectContaining({
        line: 4,
        success: false,
        error: 'Email já cadastrado',
      }),
    ]);
    expect(res.results[0].temporaryPassword).toMatch(/^[0-9a-f]{32}$/);
    expect(supabaseAdmin.createUser).toHaveBeenCalledTimes(1);
    const [sql, params] = dataSource.query.mock.calls.at(-1) as [
      string,
      unknown[],
    ];
    expect(sql).toContain("'users_imported'");
    expect(params).toEqual([
      't1',
      'u1',
      JSON.stringify({ total: 3, created: 1 }),
    ]);
  });

  it('keeps the creation hierarchy: an analista only imports clientes', async () => {
    const { service, supabaseAdmin } = setup();
    const res = await service.importCsv(
      csv(
        'Ana;ana@exemplo.dev;52998224725;analista',
        'Davi;davi@exemplo.dev;52998224725;cliente',
      ),
      caller('analista'),
    );
    expect(res.results.map((r) => r.error ?? 'ok')).toEqual([
      'Seu perfil não pode cadastrar analistas',
      'ok',
    ]);
    expect(supabaseAdmin.createUser).toHaveBeenCalledTimes(1);
  });

  it('a file without the required columns creates no one', async () => {
    const { service, userRepo, dataSource } = setup();
    await expect(
      service.importCsv(Buffer.from('nome;cpf\nAna;1'), caller('dono')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});

describe('UsersService — senha temporária até o primeiro acesso (BE-18)', () => {
  const pending = (overrides: Partial<User> = {}) =>
    ({
      id: 'u2',
      tenantId: 't1',
      role: 'analista',
      status: 'invited',
      mustChangePassword: true,
      externalId: 'ext2',
      createdBy: 'u1',
      ...overrides,
    }) as User;
  const KEPT = {
    password: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    createdAt: new Date('2026-10-14T12:00:00Z'),
  };

  it('keeps the temporary password of every analista/cliente created', async () => {
    const ctx = creationSetup();
    const res = await ctx.service.create(
      { ...dto('cliente'), cpf: '52998224725' },
      { role: 'analista', tenantId: 't1', userId: 'an1' } as RequestUserFull,
    );
    expect(ctx.tempPasswords.save).toHaveBeenCalledWith(
      'new-user',
      't1',
      res.temporaryPassword,
      'an1',
    );
  });

  it('still creates the user when the password cannot be kept', async () => {
    const ctx = creationSetup();
    ctx.tempPasswords.save.mockRejectedValue(new Error('db down'));
    const res = await ctx.service.create(
      { ...dto('analista'), cpf: '52998224725' },
      caller('dono'),
    );
    expect(res.temporaryPassword).toMatch(/^[0-9a-f]{32}$/);
  });

  it('the gestor sees the password of an analista and of a cliente; each view is audited', async () => {
    for (const role of ['analista', 'cliente'] as const) {
      const { service, userRepo, tempPasswords, dataSource } = makeService();
      userRepo.findOne.mockResolvedValue(pending({ role }));
      tempPasswords.read.mockResolvedValue(KEPT);
      await expect(
        service.getTemporaryPassword('u2', caller('dono')),
      ).resolves.toEqual({
        temporaryPassword: KEPT.password,
        createdAt: KEPT.createdAt,
      });
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u2', tenantId: 't1' },
      });
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('INSERT INTO audit_logs');
      expect(params).toEqual([
        't1',
        'u1',
        'temp_password_viewed',
        JSON.stringify({ userId: 'u2', role }),
      ]);
      expect(JSON.stringify(params)).not.toContain(KEPT.password);
    }
  });

  it('the analista sees the password of a cliente they created or whose process they handle', async () => {
    const analista = {
      role: 'analista',
      tenantId: 't1',
      userId: 'an1',
    } as RequestUserFull;
    const own = makeService();
    own.userRepo.findOne.mockResolvedValue(
      pending({ role: 'cliente', createdBy: 'an1' }),
    );
    own.tempPasswords.read.mockResolvedValue(KEPT);
    await expect(
      own.service.getTemporaryPassword('u2', analista),
    ).resolves.toMatchObject({ temporaryPassword: KEPT.password });

    const handled = makeService();
    handled.userRepo.findOne.mockResolvedValue(
      pending({ role: 'cliente', createdBy: 'outro' }),
    );
    handled.dataSource.query.mockResolvedValueOnce([{ count: '1' }]);
    handled.tempPasswords.read.mockResolvedValue(KEPT);
    await expect(
      handled.service.getTemporaryPassword('u2', analista),
    ).resolves.toMatchObject({ temporaryPassword: KEPT.password });
    expect(
      (handled.dataSource.query.mock.calls[0] as [string, unknown[]])[1],
    ).toEqual(['u2', 'an1', 't1']);
  });

  it('refuses a cliente of another analista, another analista, and the cliente role', async () => {
    const analista = {
      role: 'analista',
      tenantId: 't1',
      userId: 'an1',
    } as RequestUserFull;
    const other = makeService();
    other.userRepo.findOne.mockResolvedValue(
      pending({ role: 'cliente', createdBy: 'outro' }),
    );
    other.dataSource.query.mockResolvedValueOnce([{ count: '0' }]);
    await expect(
      other.service.getTemporaryPassword('u2', analista),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(other.tempPasswords.read).not.toHaveBeenCalled();

    const colleague = makeService();
    colleague.userRepo.findOne.mockResolvedValue(pending({ role: 'analista' }));
    await expect(
      colleague.service.getTemporaryPassword('u2', analista),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const cliente = makeService();
    cliente.userRepo.findOne.mockResolvedValue(pending({ role: 'cliente' }));
    await expect(
      cliente.service.getTemporaryPassword('u2', caller('cliente')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('RN-01: a user of another tenant is not found and nothing is read', async () => {
    const { service, userRepo, tempPasswords } = makeService();
    userRepo.findOne.mockResolvedValue(null); // the query is scoped by the caller's tenant
    await expect(
      service.getTemporaryPassword('u2', caller('dono')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tempPasswords.read).not.toHaveBeenCalled();
  });

  it('after the first sign-in (own password set) the password is gone for good', async () => {
    const { service, userRepo, tempPasswords } = makeService();
    userRepo.findOne.mockResolvedValue(
      pending({ mustChangePassword: false, status: 'active' }),
    );
    await expect(
      service.getTemporaryPassword('u2', caller('dono')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tempPasswords.remove).toHaveBeenCalledWith('u2');
    expect(tempPasswords.read).not.toHaveBeenCalled();
  });

  it('a disabled account has no password to show', async () => {
    const { service, userRepo } = makeService();
    userRepo.findOne.mockResolvedValue(pending({ status: 'disabled' }));
    await expect(
      service.getTemporaryPassword('u2', caller('dono')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports "not kept" (null) without auditing when there is nothing stored', async () => {
    const { service, userRepo, dataSource } = makeService();
    userRepo.findOne.mockResolvedValue(pending());
    await expect(
      service.getTemporaryPassword('u2', caller('dono')),
    ).resolves.toEqual({ temporaryPassword: null, createdAt: null });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('generates a new temporary password: changes it in Supabase, keeps it and audits', async () => {
    const { service, userRepo, supabaseAdmin, tempPasswords, dataSource } =
      makeService();
    userRepo.findOne.mockResolvedValue(pending());
    const res = await service.regenerateTemporaryPassword('u2', caller('dono'));
    expect(res.temporaryPassword).toMatch(/^[0-9a-f]{32}$/);
    expect(supabaseAdmin.updateUserPassword).toHaveBeenCalledWith(
      'ext2',
      res.temporaryPassword,
    );
    expect(tempPasswords.save).toHaveBeenCalledWith(
      'u2',
      't1',
      res.temporaryPassword,
      'u1',
    );
    expect((dataSource.query.mock.calls[0] as [string, unknown[]])[1]).toEqual([
      't1',
      'u1',
      'temp_password_regenerated',
      JSON.stringify({ userId: 'u2', role: 'analista' }),
    ]);
  });

  it('does not generate a new password for someone who already set their own', async () => {
    const { service, userRepo, supabaseAdmin } = makeService();
    userRepo.findOne.mockResolvedValue(
      pending({ mustChangePassword: false, status: 'active' }),
    );
    await expect(
      service.regenerateTemporaryPassword('u2', caller('dono')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(supabaseAdmin.updateUserPassword).not.toHaveBeenCalled();
  });

  it('removing a cliente also discards the kept password', async () => {
    const { service, userRepo, dataSource, tempPasswords } = makeService();
    userRepo.findOne.mockResolvedValue(pending({ role: 'cliente' }));
    dataSource.query.mockResolvedValue([{ count: '0' }]);
    await service.remove('u2', caller('dono'));
    expect(tempPasswords.remove).toHaveBeenCalledWith('u2');
  });
});
