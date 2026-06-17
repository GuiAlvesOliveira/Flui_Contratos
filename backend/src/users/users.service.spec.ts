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
  return { service, userRepo };
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
