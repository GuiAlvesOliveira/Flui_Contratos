import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { Tenant } from '../tenants/tenant.entity';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { EmailService } from '../email/email.service';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

const ALLOWED_CREATION: Record<string, string[]> = {
  admin: ['dono'],
  dono: ['analista', 'cliente'],
  analista: ['cliente'],
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly email: EmailService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateUserDto, caller: RequestUserFull) {
    if (!ALLOWED_CREATION[caller.role]?.includes(dto.role)) {
      throw new ForbiddenException('Hierarquia de criação inválida');
    }

    let targetTenantId: string;
    if (caller.role === 'admin') {
      if (!dto.tenantId) {
        throw new BadRequestException('tenantId é obrigatório para admin');
      }
      const tenant = await this.tenantRepo.findOne({
        where: { id: dto.tenantId },
      });
      if (!tenant) throw new NotFoundException('Tenant não encontrado');
      targetTenantId = dto.tenantId;
    } else {
      targetTenantId = caller.tenantId!;
    }

    if (dto.role === 'analista' || dto.role === 'cliente') {
      return this.createAnalista(dto, targetTenantId, caller.userId);
    }
    return this.createWithInvite(dto, targetTenantId, caller.userId);
  }

  private async createAnalista(dto: CreateUserDto, tenantId: string, createdBy: string) {
    if (!dto.cpf) throw new BadRequestException('CPF é obrigatório');
    const cpfDigits = dto.cpf.replace(/\D/g, '');
    if (cpfDigits.length !== 11) throw new BadRequestException('CPF inválido');

    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email já cadastrado');

    const user = this.userRepo.create({
      email: dto.email,
      name: dto.name,
      surname: dto.surname ?? null,
      cpf: dto.cpf,
      role: dto.role,
      tenantId,
      active: true,
      onboardingCompleted: false,
      mustChangePassword: true,
      externalId: null,
      createdBy,
    });
    const saved = await this.userRepo.save(user);

    let externalId: string;
    try {
      externalId = await this.supabaseAdmin.createUser(dto.email, cpfDigits, dto.role);
    } catch (err: unknown) {
      await this.userRepo.delete(saved.id);
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[UsersService] Supabase createUser failed:', msg);
      throw new InternalServerErrorException(`Supabase: ${msg}`);
    }

    await this.userRepo.update(saved.id, { externalId });
    return { ...this.toResponse(saved), temporaryPassword: cpfDigits };
  }

  private async createWithInvite(dto: CreateUserDto, tenantId: string, createdBy: string) {
    if (!dto.email) throw new BadRequestException('Email é obrigatório');

    const existing = await this.userRepo.findOne({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email já cadastrado');

    const user = this.userRepo.create({
      email: dto.email,
      name: dto.name,
      surname: dto.surname ?? null,
      cpf: dto.cpf ?? null,
      role: dto.role,
      tenantId,
      active: false,
      onboardingCompleted: false,
      mustChangePassword: true,
      externalId: null,
      invitedAt: new Date(),
      createdBy,
    });
    const saved = await this.userRepo.save(user);

    let externalId: string;
    let inviteLink: string;
    try {
      ({ externalId, inviteLink } = await this.supabaseAdmin.generateInviteLink(dto.email, dto.role));
    } catch (err: unknown) {
      await this.userRepo.delete(saved.id);
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[UsersService] Supabase generateInviteLink failed:', msg);
      throw new InternalServerErrorException(`Supabase: ${msg}`);
    }

    await this.userRepo.update(saved.id, { externalId });
    this.email.sendInvite(dto.email, dto.name, inviteLink);
    return this.toResponse({ ...saved, externalId });
  }

  async createBulk(dtos: CreateUserDto[], caller: RequestUserFull) {
    const results: { index: number; success: boolean; result?: object; error?: string }[] = [];
    for (let i = 0; i < dtos.length; i++) {
      try {
        const result = await this.create(dtos[i], caller);
        results.push({ index: i, success: true, result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ index: i, success: false, error: msg });
      }
    }
    return results;
  }

  async findAll(caller: RequestUserFull, tenantId?: string, role?: string) {
    if (caller.role === 'admin') {
      const where = tenantId ? { tenantId } : {};
      const users = await this.userRepo.find({ where });
      return users.map((u) => this.toResponse(u));
    }

    const where: Record<string, unknown> = {
      tenantId: caller.tenantId!,
      role: role ? role : In(['dono', 'analista', 'cliente']),
    };
    const users = await this.userRepo.find({ where });
    return users.map((u) => this.toResponse(u));
  }

  async findOne(id: string, caller: RequestUserFull) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (caller.role !== 'admin' && user.tenantId !== caller.tenantId) {
      throw new ForbiddenException();
    }

    return this.toResponse(user);
  }

  async updateProfile(
    id: string,
    dto: UpdateProfileDto,
    caller: RequestUserFull,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (caller.role !== 'admin' && user.tenantId !== caller.tenantId) throw new ForbiddenException();
    if (caller.role === 'cliente' && id !== caller.userId) throw new ForbiddenException();

    const { processId, ...fields } = dto;
    Object.assign(user, fields);
    const saved = await this.userRepo.save(user);

    if (processId) {
      const changedKeys = Object.keys(fields).join(', ');
      await this.dataSource.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
         VALUES ($1, $2, $3, 'profile_update', $4::jsonb)`,
        [caller.tenantId ?? user.tenantId, processId, caller.userId, JSON.stringify({ fields: changedKeys })],
      );
    }

    return this.toResponse(saved);
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, caller: RequestUserFull) {
    if (id === caller.userId) {
      throw new ForbiddenException('Não é possível alterar o próprio status');
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (caller.role !== 'admin' && user.tenantId !== caller.tenantId) {
      throw new ForbiddenException();
    }

    await this.userRepo.update(id, { active: dto.active });
    return { id, active: dto.active };
  }

  async remove(id: string, caller: RequestUserFull) {
    const user = await this.userRepo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.role !== 'cliente') throw new ForbiddenException('Só é possível excluir usuários com role cliente');

    const [{ count }] = await this.dataSource.query<[{ count: string }]>(
      `SELECT COUNT(*) AS count FROM processes WHERE client_id = $1 AND active = true`,
      [id],
    );
    if (Number(count) > 0) {
      throw new BadRequestException('Cliente possui processos ativos');
    }

    await this.userRepo.update(id, { active: false });

    if (user.externalId) {
      try {
        await this.supabaseAdmin.deleteUser(user.externalId);
      } catch (err) {
        console.warn('[UsersService] Supabase deleteUser failed (non-fatal):', err);
      }
    }

    return { id, deleted: true };
  }

  async resendInvite(id: string, caller: RequestUserFull) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (caller.role !== 'admin' && user.tenantId !== caller.tenantId) {
      throw new ForbiddenException();
    }

    if (user.onboardingCompleted) {
      throw new BadRequestException('Usuário já completou o onboarding');
    }

    const { externalId, inviteLink } = await this.supabaseAdmin.generateInviteLink(user.email, user.role);
    const updates: Partial<User> = { invitedAt: new Date() };
    if (!user.externalId) updates.externalId = externalId;
    await this.userRepo.update(id, updates);
    this.email.sendInvite(user.email, user.name ?? user.email, inviteLink);
    return { message: 'Convite reenviado' };
  }

  private toResponse(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      surname: user.surname,
      cpf: user.cpf,
      rg: user.rg,
      role: user.role,
      tenantId: user.tenantId,
      active: user.active,
      onboardingCompleted: user.onboardingCompleted,
      mustChangePassword: user.mustChangePassword,
      invitedAt: user.invitedAt,
      createdBy: user.createdBy,
      createdAt: user.createdAt,
    };
  }
}
