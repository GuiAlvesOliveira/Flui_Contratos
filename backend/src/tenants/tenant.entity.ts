import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { TenantTheme } from './tenant-theme';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 100, unique: true })
  slug: string;

  @Column({ default: true })
  active: boolean;

  // PROD-04: key of the logo in the private container (never sent to the browser)
  @Column({ type: 'varchar', name: 'logo_path', length: 500, nullable: true })
  logoPath: string | null;

  @Column({ type: 'varchar', name: 'logo_mime', length: 50, nullable: true })
  logoMime: string | null;

  @Column({ type: 'timestamptz', name: 'logo_updated_at', nullable: true })
  logoUpdatedAt: Date | null;

  // Cor do sistema escolhida pelo gestor na paleta (ver tenant-theme.ts)
  @Column({
    type: 'varchar',
    name: 'theme_color',
    length: 20,
    default: 'floresta',
  })
  themeColor: TenantTheme;

  // Envio de e-mails: 'manual' = o gestor libera cada mensagem; 'auto' = sai sozinho
  @Column({
    type: 'varchar',
    name: 'email_mode',
    length: 10,
    default: 'manual',
  })
  emailMode: 'manual' | 'auto';

  // Teto de e-mails por dia da assessoria
  @Column({ type: 'int', name: 'email_daily_limit', default: 100 })
  emailDailyLimit: number;

  // PROD-09: plano contratado (taxa do success fee); só o Super Admin altera
  @Column({ type: 'varchar', length: 20, default: 'essencial' })
  plano: 'essencial' | 'profissional' | 'escala';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
