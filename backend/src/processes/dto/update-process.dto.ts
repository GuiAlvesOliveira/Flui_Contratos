import { IsIn, IsNumber, IsOptional, IsUUID, isNumber, ValidateBy } from 'class-validator';
import { ESTADOS_CIVIS, FONTES_RENDA } from '../../common/civil-status';

const MAX_COMMISSION = 9_999_999_999_999;

// PROD-09: one message per problem (a text used to get three mixed messages)
function IsCommission(): PropertyDecorator {
  return ValidateBy({
    name: 'isCommission',
    validator: {
      validate: (v: unknown) =>
        isNumber(v, { maxDecimalPlaces: 2 }) && v >= 0 && v <= MAX_COMMISSION,
      defaultMessage: (args) => {
        const v: unknown = args?.value;
        if (!isNumber(v)) return 'A comissão deve ser um número em reais';
        if (v < 0) return 'A comissão não pode ser negativa';
        if (v > MAX_COMMISSION) return 'A comissão está acima do limite';
        return 'A comissão aceita até 2 casas decimais';
      },
    },
  });
}

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

  @IsOptional() @IsIn(FONTES_RENDA)
  fonteRenda?: string | null;

  // viúvo(a) e união estável também (a tela sempre ofereceu; a API recusava)
  @IsOptional() @IsIn(ESTADOS_CIVIS)
  estadoCivil?: string | null;

  /** PROD-09: comissão da assessoria no contrato (R$); null limpa. */
  @IsOptional()
  @IsCommission()
  comissaoAssessoria?: number | null;
}
