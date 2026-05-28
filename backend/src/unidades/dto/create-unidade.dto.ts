import { IsNumber, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateUnidadeDto {
  @IsUUID()
  empreendimentoId: string;

  @IsString() @MinLength(1)
  identificacao: string;

  @IsOptional() @IsNumber()
  valor?: number;
}
