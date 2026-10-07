import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PASSWORD_CHANGE_EXEMPT_KEY } from '../decorators/password-change-exempt.decorator';
import { RequestUser, RequestUserFull } from '../../auth/supabase.guard';
import { UserContextCache } from '../../auth/user-context.cache';
import { User } from '../../users/user.entity';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly reflector: Reflector,
    // Shared with the services that change users, so they can invalidate it (AUTH-09).
    private readonly cache: UserContextCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const passwordChangeExempt = this.reflector.getAllAndOverride<boolean>(
      PASSWORD_CHANGE_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException();
    }

    const cached = this.cache.get(user.externalId);
    if (cached) {
      this.enforcePasswordChange(cached, passwordChangeExempt);
      (request as { user: RequestUserFull }).user = cached;
      return true;
    }

    this.cache.pruneExpired();

    let found = await this.userRepo.findOne({
      where: { externalId: user.externalId },
      relations: ['tenant'],
    });

    // Lazy binding: first login before external_id is set in DB. A disabled
    // account is never bound — it falls through to the "inativo" rejection.
    if (!found && user.email) {
      const byEmail = await this.userRepo.findOne({
        where: { email: user.email },
        relations: ['tenant'],
      });
      if (byEmail && byEmail.status !== 'disabled') {
        await this.userRepo.update(byEmail.id, { externalId: user.externalId });
        byEmail.externalId = user.externalId;
      }
      found = byEmail;
    }

    if (!found) {
      throw new ForbiddenException('Usuário não provisionado');
    }
    // SEC-02: `disabled` is sticky — only PATCH /users/:id/status re-enables it.
    if (found.status === 'disabled') {
      throw new ForbiddenException('Usuário inativo');
    }
    // First authenticated access of an invited account activates it.
    if (found.status === 'invited') {
      await this.userRepo.update(found.id, { status: 'active' });
      found.status = 'active';
    }
    if (found.tenant && !found.tenant.active) {
      throw new ForbiddenException('Tenant inativo');
    }

    const fullUser: RequestUserFull = {
      externalId: found.externalId ?? user.externalId,
      email: found.email,
      tenantId: found.tenantId,
      role: found.role,
      userId: found.id,
      name: found.name,
      onboardingCompleted: found.onboardingCompleted,
      mustChangePassword: found.mustChangePassword,
    };

    // Don't cache users that must change their password so the flag clears immediately after update
    if (!found.mustChangePassword) {
      this.cache.set(user.externalId, fullUser);
    }
    this.enforcePasswordChange(fullUser, passwordChangeExempt);
    (request as { user: RequestUserFull }).user = fullUser;
    return true;
  }

  private enforcePasswordChange(user: RequestUserFull, exempt: boolean): void {
    if (user.mustChangePassword && !exempt) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Troca de senha obrigatória antes de acessar a API',
      });
    }
  }
}
