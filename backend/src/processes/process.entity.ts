import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Unidade } from '../unidades/unidade.entity';

export type ProcessStage =
  | 'inicial'
  | 'cadastro'
  | 'analise_credito'
  | 'credito_aprovado'
  | 'analise_juridica'
  | 'juridico_aprovado'
  | 'cartorio'
  | 'assinatura'
  | 'cliente_inativo'
  | 'credito_recusado'
  | 'processo_pendencia';

export const STAGE_LABELS: Record<ProcessStage, string> = {
  inicial: 'Primeiro Contato',
  cadastro: 'Cadastro',
  analise_credito: 'Análise de Crédito',
  credito_aprovado: 'Crédito Aprovado',
  analise_juridica: 'Análise Jurídica',
  juridico_aprovado: 'Jurídico Aprovado',
  cartorio: 'Cartório',
  assinatura: 'Assinatura',
  cliente_inativo: 'Inativo',
  credito_recusado: 'Crédito Recusado',
  processo_pendencia: 'Pendência',
};

// Complete state machine (BR-01). Linear path is single-step forward; every
// active stage can be put on hold (processo_pendencia) or dropped
// (cliente_inativo); side stages can be reopened/resumed. assinatura is terminal.
export const ALLOWED_TRANSITIONS: Record<ProcessStage, ProcessStage[]> = {
  inicial: ['cadastro', 'cliente_inativo'],
  cadastro: ['analise_credito', 'cliente_inativo', 'processo_pendencia'],
  analise_credito: ['credito_aprovado', 'credito_recusado', 'cliente_inativo', 'processo_pendencia'],
  credito_aprovado: ['analise_juridica', 'cliente_inativo', 'processo_pendencia'],
  analise_juridica: ['juridico_aprovado', 'cliente_inativo', 'processo_pendencia'],
  juridico_aprovado: ['cartorio', 'cliente_inativo', 'processo_pendencia'],
  cartorio: ['assinatura', 'cliente_inativo', 'processo_pendencia'],
  assinatura: [],
  cliente_inativo: ['inicial'],
  credito_recusado: ['analise_credito'],
  processo_pendencia: [
    'analise_credito', 'credito_aprovado', 'analise_juridica',
    'juridico_aprovado', 'cartorio', 'cliente_inativo',
  ],
};

@Entity('processes')
export class Process {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId: string;

  @Column({ type: 'uuid', name: 'analista_id', nullable: true })
  analistaId: string | null;

  @Column({ type: 'uuid', name: 'unidade_id', nullable: true })
  unidadeId: string | null;

  @Column({ type: 'varchar', length: 50, default: 'inicial' })
  stage: ProcessStage;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'mip_value', nullable: true })
  mipValue: number | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'dfi_value', nullable: true })
  dfiValue: number | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'valor_unidade', nullable: true })
  valorUnidade: number | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'valor_em_aberto', nullable: true })
  valorEmAberto: number | null;

  @Column({ type: 'varchar', name: 'motivo_inatividade', length: 50, nullable: true })
  motivoInatividade: string | null;

  @Column({ type: 'varchar', name: 'fonte_renda', length: 20, nullable: true })
  fonteRenda: string | null;

  @Column({ type: 'varchar', name: 'estado_civil', length: 20, nullable: true })
  estadoCivil: string | null;

  @Column({ name: 'motivo_recusa', type: 'text', nullable: true })
  motivoRecusa: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'client_id' })
  client: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'analista_id' })
  analista: User | null;

  @ManyToOne(() => Unidade, { nullable: true })
  @JoinColumn({ name: 'unidade_id' })
  unidade: Unidade | null;
}
