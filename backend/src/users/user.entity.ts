import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

export type UserStatus = 'invited' | 'active' | 'disabled';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id', nullable: true })
  tenantId: string | null;

  @Index()
  @Column({ type: 'varchar', name: 'external_id', unique: true, length: 255, nullable: true })
  externalId: string | null;

  @Column({ type: 'varchar', length: 20 })
  role: 'admin' | 'dono' | 'analista' | 'cliente';

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  // SEC-02: explicit account state. `invited` = created, awaiting first login
  // (the TenantGuard turns it into `active`); `disabled` is only ever set and
  // cleared explicitly (PATCH /users/:id/status) and is never auto-reactivated.
  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: UserStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  surname: string | null;

  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rg: string | null;

  @Column({ type: 'boolean', name: 'onboarding_completed', default: false })
  onboardingCompleted: boolean;

  @Column({ type: 'boolean', name: 'must_change_password', default: false })
  mustChangePassword: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefone: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
  invitedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Tenant, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant | null;
}
