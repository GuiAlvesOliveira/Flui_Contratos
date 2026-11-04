import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { EstadoCivil } from '../common/civil-status';
import { FichaPessoal } from '../ficha/ficha-pessoal.embedded';
import { Process } from '../processes/process.entity';
import { Tenant } from '../tenants/tenant.entity';

@Entity('process_participants')
export class ProcessParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'process_id' })
  processId: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 14, nullable: true })
  cpf: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, name: 'declared_income' })
  declaredIncome: number;

  // Ficha completa do 2º comprador/cônjuge: os dados básicos que o cliente
  // tem em users, com os mesmos nomes, mais o embutido da ficha
  @Column({ type: 'varchar', length: 20, nullable: true })
  rg: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefone: string | null;

  @Column({ type: 'date', name: 'data_nascimento', nullable: true })
  dataNascimento: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  cep: string | null;

  @Column({ type: 'varchar', name: 'estado_civil', length: 20, nullable: true })
  estadoCivil: EstadoCivil | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column(() => FichaPessoal, { prefix: false })
  ficha: FichaPessoal;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Process)
  @JoinColumn({ name: 'process_id' })
  process: Process;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
