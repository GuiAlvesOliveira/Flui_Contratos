import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { EmailService } from '../email/email.service';
import { User } from '../users/user.entity';

/**
 * BE-08: "esqueci minha senha". The answer never depends on the e-mail: the
 * lookup and the sending happen after the response, so neither the body nor
 * the timing tells whether an account exists.
 */
@Injectable()
export class PasswordResetService {
  static readonly COOLDOWN_MS = 60_000;

  private readonly logger = new Logger(PasswordResetService.name);
  // One e-mail per address per minute, whatever the IP (inbox flooding).
  private readonly lastSent = new Map<string, number>();

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly email: EmailService,
  ) {}

  request(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    return this.send(email).catch((err: unknown) => {
      this.logger.warn(
        `Recuperação de senha não enviada: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async send(email: string, now = Date.now()): Promise<void> {
    for (const [key, at] of this.lastSent) {
      if (now - at >= PasswordResetService.COOLDOWN_MS)
        this.lastSent.delete(key);
    }
    if (this.lastSent.has(email)) return;
    this.lastSent.set(email, now);

    const user = await this.userRepo
      .createQueryBuilder('u')
      .where('LOWER(u.email) = :email', { email })
      .getOne();
    if (!user || user.status === 'disabled') return;

    const link = await this.supabaseAdmin.generateRecoveryLink(user.email);
    await this.email.sendPasswordReset(
      user.email,
      user.name ?? user.email,
      link,
    );
  }
}
