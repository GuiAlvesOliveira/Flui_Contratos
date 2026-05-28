import { IsIn, IsOptional, IsString } from 'class-validator';
import type { ProcessStage } from '../process.entity';

const ALL_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
  'cliente_inativo', 'credito_recusado', 'processo_pendencia',
];

export class AdvanceStageDto {
  @IsIn(ALL_STAGES)
  toStage: ProcessStage;

  @IsOptional()
  @IsIn(['recursos_proprios', 'outra_assessoria', 'sozinho', 'nao_atendeu'])
  motivoInatividade?: string;

  @IsOptional() @IsString()
  motivoRecusa?: string;
}
