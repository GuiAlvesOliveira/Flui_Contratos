import { IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * Whitelist for PATCH /processes/:id (updateFields).
 * Intentionally excludes `stage` — stage transitions must go through
 * PATCH /processes/:id/stage (advanceStage), which enforces the RN-04 document
 * gate. It also excludes tenantId, clientId and active (mass-assignment guard,
 * SEC-01). All fields are optional and accept null so the UI can clear them.
 */
export class UpdateProcessDto {
  @IsOptional() @IsUUID()
  analistaId?: string | null;

  @IsOptional() @IsUUID()
  unidadeId?: string | null;

  @IsOptional() @IsNumber()
  valorUnidade?: number | null;

  @IsOptional() @IsNumber()
  valorEmAberto?: number | null;

  @IsOptional() @IsNumber()
  mipValue?: number | null;

  @IsOptional() @IsNumber()
  dfiValue?: number | null;

  @IsOptional() @IsIn(['assalariado', 'nao_assalariado'])
  fonteRenda?: string | null;

  @IsOptional() @IsIn(['casado', 'solteiro', 'divorciado'])
  estadoCivil?: string | null;

  /** PROD-09: comissão da assessoria no contrato (R$); null limpa. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Comissão inválida' })
  @Min(0, { message: 'A comissão não pode ser negativa' })
  @Max(9_999_999_999_999, { message: 'Comissão inválida' })
  comissaoAssessoria?: number | null;
}
