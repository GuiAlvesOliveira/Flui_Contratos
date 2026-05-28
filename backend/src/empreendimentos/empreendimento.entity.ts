import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

@Entity('empreendimentos')
export class Empreendimento {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ length: 255 })
  nome: string;

  @Column({ name: 'matricula_mae', length: 100 })
  matriculaMae: string;

  @Column({ type: 'text' })
  endereco: string;

  @Column({ length: 10 })
  cep: string;

  @Column({ name: 'banco_financiador', length: 255 })
  bancoFinanciador: string;

  @Column({ name: 'construtora_info', type: 'text', nullable: true })
  construtoraInfo: string | null;

  @Column({ name: 'incorporadora_contato', type: 'varchar', length: 255, nullable: true })
  incorporadoraContato: string | null;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
