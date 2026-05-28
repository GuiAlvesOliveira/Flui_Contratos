import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

export interface RequestUser {
  externalId: string;
  email: string;
}

export interface RequestUserFull extends RequestUser {
  tenantId: string | null;
  role: 'admin' | 'dono' | 'analista' | 'cliente';
  userId: string;
  name: string | null;
  onboardingCompleted: boolean;
  mustChangePassword: boolean;
}

@Injectable()
export class SupabaseGuard implements CanActivate {
  private readonly supabase: SupabaseClient;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.supabase = createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>('SUPABASE_ANON_KEY'),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string }; user?: RequestUser }>();

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException();
    }

    const token = authHeader.slice(7);
    const { data: { user }, error } = await this.supabase.auth.getUser(token);

    if (error || !user) {
      throw new UnauthorizedException();
    }

    request.user = { externalId: user.id, email: user.email ?? '' };
    return true;
  }
}
