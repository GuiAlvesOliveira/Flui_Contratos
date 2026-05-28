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

  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pendente' })
  status: DocumentStatus;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'text', name: 'validated_by_notes', nullable: true })
  validatedByNotes: string | null;

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
