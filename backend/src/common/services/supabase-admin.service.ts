import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAdminService {
  private readonly supabase: SupabaseClient;

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
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
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
