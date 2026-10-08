import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
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

// Errors that mean "this token is not valid" — no point asking Supabase again
const REJECTED = new Set(['AuthInvalidJwtError', 'AuthApiError']);

@Injectable()
export class SupabaseGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseGuard.name);
  private readonly supabase: SupabaseClient;
  private readonly issuer: string;
  private claimsMismatchLogged = false;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const url = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/+$/, '');
    this.supabase = createClient(
      url,
      this.config.getOrThrow<string>('SUPABASE_ANON_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    this.issuer = `${url}/auth/v1`;
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

    const user = await this.verify(authHeader.slice(7));
    if (!user) throw new UnauthorizedException();
    request.user = user;
    return true;
  }

  // SEC-03: the token is checked here — signature against the project's public
  // keys (JWKS, cached for 10 minutes by supabase-js), exp, aud and iss — with
  // no round-trip to Supabase per request. HS256 tokens and keys missing from
  // the JWKS are validated by getUser() inside getClaims(); if the JWKS cannot
  // be fetched at all, this falls back to getUser() too.
  private async verify(token: string): Promise<RequestUser | null> {
    let result: Awaited<ReturnType<SupabaseClient['auth']['getClaims']>>;
    try {
      result = await this.supabase.auth.getClaims(token);
    } catch (e) {
      // supabase-js throws plain errors for an expired/malformed exp claim
      if (e instanceof Error && /expired|exp claim/i.test(e.message)) {
        return null;
      }
      return this.viaGetUser(token);
    }
    const { data, error } = result;
    if (error) return REJECTED.has(error.name) ? null : this.viaGetUser(token);

    const claims = data?.claims;
    if (!claims?.sub) return null;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes('authenticated') || claims.iss !== this.issuer) {
      // The signature already matched this project's keys, so a different
      // aud/iss is either a non-user token or a config mismatch: Supabase
      // decides (getUser), and the mismatch is logged once to be fixed.
      if (!this.claimsMismatchLogged) {
        this.claimsMismatchLogged = true;
        this.logger.warn(
          `Token com aud/iss inesperado (iss=${String(claims.iss)}); validado pelo Supabase`,
        );
      }
      return this.viaGetUser(token);
    }
    const email = typeof claims.email === 'string' ? claims.email : '';
    return { externalId: claims.sub, email };
  }

  private async viaGetUser(token: string): Promise<RequestUser | null> {
    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { externalId: data.user.id, email: data.user.email ?? '' };
  }
}
