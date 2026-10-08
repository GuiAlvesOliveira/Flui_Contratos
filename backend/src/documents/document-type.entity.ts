import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

export const DOCUMENT_CATEGORIES = [
  'pessoal',
  'renda',
  'imovel',
  'outros',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

/**
 * BE-03: the assessoria's document catalog ("Lista de Documentos"). The gestor
 * maintains it for the whole tenant; the analista requests documents for a
 * process by picking from it, never free text. Types are deactivated instead
 * of deleted, so documents already requested keep their history.
 */
@Entity('document_types')
export class DocumentType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ length: 120 })
  label: string;

  @Column({ type: 'varchar', length: 30 })
  category: DocumentCategory;

  // Guidance shown to the analista and the cliente (e.g. "últimos 3 meses")
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}

// Starting catalog for a tenant: the documents the old fixed checklists asked
// for (personal docs + both income-source lists). The gestor edits it freely.
export const DEFAULT_DOCUMENT_TYPES: {
  label: string;
  category: DocumentCategory;
}[] = [
  { label: 'RG ou CNH', category: 'pessoal' },
  { label: 'Comprovante de Endereço', category: 'pessoal' },
  { label: 'Certidão de Estado Civil', category: 'pessoal' },
  { label: 'Holerite (mês 1)', category: 'renda' },
  { label: 'Holerite (mês 2)', category: 'renda' },
  { label: 'Holerite (mês 3)', category: 'renda' },
  { label: 'Declaração de IRPF', category: 'renda' },
  { label: 'Extrato Bancário (mês 1)', category: 'renda' },
  { label: 'Extrato Bancário (mês 2)', category: 'renda' },
  { label: 'Extrato Bancário (mês 3)', category: 'renda' },
  { label: 'Extrato Bancário (mês 4)', category: 'renda' },
  { label: 'Extrato Bancário (mês 5)', category: 'renda' },
  { label: 'Extrato Bancário (mês 6)', category: 'renda' },
];
