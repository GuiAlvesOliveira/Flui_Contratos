import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';
import { DataSource } from 'typeorm';

/**
 * BE-18: keeps the temporary password of an analista/cliente who has not
 * signed in yet, so the gestor (or the analista, for their clientes) can see it
 * again after the page that showed it is gone. Stored encrypted (AES-256-GCM,
 * bound to the user id) and deleted as soon as the person sets their own
 * password — after that it no longer works anyway.
 *
 * Key: TEMP_PASSWORD_KEY when set; otherwise derived (HKDF) from the Supabase
 * service-role key, which the API already holds. Rotating either makes the
 * stored values unreadable: they are reported as unavailable and a new
 * temporary password can be generated.
 */
@Injectable()
export class TemporaryPasswordStore {
  private readonly logger = new Logger(TemporaryPasswordStore.name);
  private readonly key: Buffer | null;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    const secret =
      config.get<string>('TEMP_PASSWORD_KEY') ||
      config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    this.key = secret
      ? Buffer.from(
          hkdfSync(
            'sha256',
            secret,
            'flui-contratos',
            'temporary-password:v1',
            32,
          ),
        )
      : null;
  }

  async save(
    userId: string,
    tenantId: string,
    password: string,
    createdBy: string | null,
  ): Promise<void> {
    if (!this.key) return;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(userId));
    const data = Buffer.concat([
      cipher.update(password, 'utf8'),
      cipher.final(),
    ]);
    const secret = [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      data.toString('base64'),
    ].join('.');
    await this.dataSource.query(
      `INSERT INTO user_temp_passwords (user_id, tenant_id, secret, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET secret = EXCLUDED.secret, created_by = EXCLUDED.created_by, created_at = now()`,
      [userId, tenantId, secret, createdBy],
    );
  }

  async read(
    userId: string,
  ): Promise<{ password: string; createdAt: Date } | null> {
    const rows = await this.dataSource.query<
      { secret: string; created_at: Date }[]
    >(`SELECT secret, created_at FROM user_temp_passwords WHERE user_id = $1`, [
      userId,
    ]);
    if (!rows.length || !this.key) return null;
    const [version, iv, tag, data] = rows[0].secret.split('.');
    if (version !== 'v1') return null;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(userId));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const password = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      return { password, createdAt: rows[0].created_at };
    } catch {
      this.logger.warn(
        `Temporary password of ${userId} could not be decrypted`,
      );
      return null;
    }
  }

  async remove(userId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM user_temp_passwords WHERE user_id = $1`,
      [userId],
    );
  }
}
