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
import type { EstadoCivil, FonteRenda } from '../common/civil-status';

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

  // FE-20: YYYY-MM-DD (pg DATE comes back as a plain string, no time zone shift)
  @Column({ type: 'date', name: 'data_nascimento', nullable: true })
  dataNascimento: string | null;

  // PROD-06: 8 digits, no hyphen
  @Column({ type: 'varchar', length: 8, nullable: true })
  cep: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endereco: string | null;

  // Declarados pelo cliente no onboarding; preenchem os processos dele que
  // ainda não têm esses dados (o valor de cada processo fica no processo)
  @Column({ type: 'varchar', name: 'estado_civil', length: 20, nullable: true })
  estadoCivil: EstadoCivil | null;

  @Column({ type: 'varchar', name: 'fonte_renda', length: 20, nullable: true })
  fonteRenda: FonteRenda | null;

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
