import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Only the unidade's own data: empreendimentoId and tenantId are not accepted
// (forbidNonWhitelisted rejects them), so a unidade can't change hands.
export class UpdateUnidadeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  identificacao?: string;

  // null clears the value
  @IsOptional()
  @IsNumber()
  valor?: number | null;
}
