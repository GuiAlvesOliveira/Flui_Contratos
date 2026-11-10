import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Process } from '../processes/process.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import type { FormType } from './document-forms';

export type DocumentStatus = 'pendente' | 'recebido' | 'validado' | 'rejeitado';

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'process_id', nullable: true })
  processId: string | null;

  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  stage: string | null;

  @Column({ length: 255 })
  name: string;

  @Column({ type: 'varchar', name: 'blob_path', length: 500, nullable: true })
  blobPath: string | null;

  @Column({ type: 'varchar', name: 'mime_type', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true })
  sizeBytes: number | null;

  @Column({ default: false })
  validated: boolean;

  @Column({ type: 'uuid', name: 'validated_by', nullable: true })
  validatedBy: string | null;

  @Column({ type: 'timestamptz', name: 'validated_at', nullable: true })
  validatedAt: Date | null;

  @Column({ type: 'uuid', name: 'uploaded_by', nullable: true })
  uploadedBy: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  category: string | null;

  @Column({ type: 'varchar', name: 'doc_type', length: 50, nullable: true })
  docType: string | null;

  // BE-03: catalog entry this request came from (null for very old rows)
  @Column({ type: 'uuid', name: 'document_type_id', nullable: true })
  documentTypeId: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pendente' })
  status: DocumentStatus;

  // FE-23: form filled in the app (DPS, financing) instead of an uploaded file
  @Column({ type: 'varchar', name: 'form_type', length: 30, nullable: true })
  formType: FormType | null;

  @Column({ type: 'jsonb', name: 'form_data', nullable: true })
  formData: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', name: 'validated_by_notes', nullable: true })
  validatedByNotes: string | null;

  // Validade pelo mês de referência (document-validity.ts): gravada quando o
  // analista valida um documento de tipo com prazo. referenceMonth é o dia 1
  // do mês; validUntil, o último dia de validade (inclusive); validityMonths, o
  // prazo da lista usado no cálculo. Um arquivo novo ou a rejeição limpam tudo.
  @Column({ type: 'date', name: 'reference_month', nullable: true })
  referenceMonth: string | null;

  @Column({ type: 'date', name: 'valid_until', nullable: true })
  validUntil: string | null;

  @Column({ type: 'smallint', name: 'validity_months', nullable: true })
  validityMonths: number | null;

  @Column({ type: 'uuid', name: 'reference_month_set_by', nullable: true })
  referenceMonthSetBy: string | null;

  @Column({
    type: 'timestamptz',
    name: 'reference_month_set_at',
    nullable: true,
  })
  referenceMonthSetAt: Date | null;

  // quando a rotina diária registrou o vencimento (pendência + aviso)
  @Column({ type: 'timestamptz', name: 'expired_at', nullable: true })
  expiredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @ManyToOne(() => Process, { nullable: true })
  @JoinColumn({ name: 'process_id' })
  process: Process | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'uploaded_by' })
  uploader: User | null;
}
