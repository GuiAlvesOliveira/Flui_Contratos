import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { primaryFrontendUrl } from '../frontend-url';

@Injectable()
export class SupabaseAdminService {
  // the type createClient returns (the bare SupabaseClient has other generics)
  private readonly supabase: ReturnType<typeof createClient>;

  constructor(private readonly config: ConfigService) {
    this.supabase = createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async generateInviteLink(
    email: string,
    role: string,
  ): Promise<{ externalId: string; inviteLink: string }> {
    // FRONTEND_URL can be a CORS list — the redirect must be a single URL.
    const frontendUrl = primaryFrontendUrl(this.config.get<string>('FRONTEND_URL'));
    const { data, error } = await this.supabase.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: { role }, redirectTo: `${frontendUrl}/set-password` },
    });
    if (error || !data?.user) {
      throw new InternalServerErrorException(error?.message ?? 'generateLink failed');
    }
    return {
      externalId: data.user.id,
      inviteLink: data.properties.action_link,
    };
  }

  // BE-08: the link signs the user in with a recovery session and lands on the
  // same page as the invite, which lets them choose a new password.
  async generateRecoveryLink(email: string): Promise<string> {
    const frontendUrl = primaryFrontendUrl(
      this.config.get<string>('FRONTEND_URL'),
    );
    const { data, error } = await this.supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${frontendUrl}/set-password` },
    });
    if (error || !data?.properties?.action_link) {
      throw new InternalServerErrorException(
        error?.message ?? 'generateLink failed',
      );
    }
    return data.properties.action_link;
  }

  async createUser(email: string, password: string, role: string): Promise<string> {
    const { data, error } = await this.supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role },
    });
    if (error || !data.user) throw new InternalServerErrorException(error?.message ?? 'Supabase createUser failed');
    return data.user.id;
  }

  async updateUserPassword(externalId: string, newPassword: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.updateUserById(externalId, {
      password: newPassword,
    });
    if (error) throw new InternalServerErrorException(error.message);
  }

  async deleteUser(externalId: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(externalId);
    if (error) throw new InternalServerErrorException(error.message);
  }
}
