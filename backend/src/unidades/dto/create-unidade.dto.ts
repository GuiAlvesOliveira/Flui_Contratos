import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateUnidadeDto {
  @IsUUID()
  empreendimentoId: string;

  @IsString() @MinLength(1) @MaxLength(100)
  identificacao: string;

  @IsOptional() @IsNumber()
  valor?: number;
}
