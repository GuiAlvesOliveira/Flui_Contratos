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
import { RequestUser, RequestUserFull } from '../../auth/supabase.guard';
import { User } from '../../users/user.entity';

@Injectable()
export class TenantGuard implements CanActivate {
  private readonly cache = new Map<
    string,
    { data: RequestUserFull; expiresAt: number }
  >();
  private readonly TTL_MS = 60_000;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException();
    }

    const now = Date.now();
    const cached = this.cache.get(user.externalId);

    if (cached && cached.expiresAt > now) {
      (request as { user: RequestUserFull }).user = cached.data;
      return true;
    }

    for (const [key, val] of this.cache) {
      if (val.expiresAt < now) {
        this.cache.delete(key);
      }
    }

    let found = await this.userRepo.findOne({
      where: { externalId: user.externalId },
      relations: ['tenant'],
    });

    // Lazy binding: first login before external_id is set in DB
    if (!found && user.email) {
      const byEmail = await this.userRepo.findOne({
        where: { email: user.email },
        relations: ['tenant'],
      });
      if (byEmail) {
        // First login after invite: bind external_id and activate the account
        await this.userRepo.update(byEmail.id, {
          externalId: user.externalId,
          active: true,
        });
        byEmail.externalId = user.externalId;
        byEmail.active = true;
        found = byEmail;
      }
    }

    if (!found) {
      throw new ForbiddenException('Usuário não provisionado');
    }
    // Auto-activate on first real login if user accepted the invite but active is still false
    if (!found.active && found.externalId) {
      await this.userRepo.update(found.id, { active: true });
      found.active = true;
    }
    if (!found.active) {
      throw new ForbiddenException('Usuário inativo');
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
      this.cache.set(user.externalId, {
        data: fullUser,
        expiresAt: now + this.TTL_MS,
      });
    }
    (request as { user: RequestUserFull }).user = fullUser;
    return true;
  }
}
