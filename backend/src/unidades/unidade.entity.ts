import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Empreendimento } from '../empreendimentos/empreendimento.entity';

@Entity('unidades')
export class Unidade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'uuid', name: 'empreendimento_id' })
  empreendimentoId: string;

  @Column({ length: 100 })
  identificacao: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  valor: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Empreendimento)
  @JoinColumn({ name: 'empreendimento_id' })
  empreendimento: Empreendimento;
}
