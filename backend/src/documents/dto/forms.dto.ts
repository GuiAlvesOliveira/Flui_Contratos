import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

// Required text up to `max` characters, reported with a single message
function RequiredText(max: number, message: string) {
  return ValidateBy({
    name: 'requiredText',
    validator: {
      validate: (v: unknown) =>
        typeof v === 'string' && v.trim().length > 0 && v.length <= max,
      defaultMessage: () => message,
    },
  });
}

/**
 * PUT /processes/:id/forms/dps (FE-23) — Declaração Pessoal de Saúde used by
 * the insurer for the MIP coverage. Any "yes" needs details.
 */
export class DpsFormDto {
  @IsInt()
  @Min(100)
  @Max(250)
  alturaCm: number;

  @IsNumber()
  @Min(30)
  @Max(300)
  pesoKg: number;

  @IsBoolean()
  tratamento: boolean;

  @IsBoolean()
  doencaGrave: boolean;

  @IsBoolean()
  internacao: boolean;

  @IsBoolean()
  deficiencia: boolean;

  @IsBoolean()
  afastamento: boolean;

  @ValidateIf(
    (o: DpsFormDto) =>
      o.tratamento ||
      o.doencaGrave ||
      o.internacao ||
      o.deficiencia ||
      o.afastamento ||
      o.detalhes !== undefined,
  )
  @RequiredText(
    1000,
    'descreva os itens marcados como "sim" (até 1000 caracteres)',
  )
  detalhes?: string;

  @Equals(true, { message: 'é preciso confirmar a declaração' })
  declaracao: boolean;
}

/** PUT /processes/:id/forms/financiamento (FE-23) — filled by the assessoria. */
export class FinanciamentoFormDto {
  @IsString()
  @Length(2, 100)
  banco: string;

  @IsIn(['SAC', 'PRICE'])
  sistemaAmortizacao: 'SAC' | 'PRICE';

  @IsInt()
  @Min(12)
  @Max(420)
  prazoMeses: number;

  @IsNumber()
  @Min(1)
  valorFinanciado: number;

  @IsNumber()
  @Min(0)
  valorEntrada: number;

  @IsBoolean()
  usaFgts: boolean;

  @ValidateIf((o: FinanciamentoFormDto) => o.usaFgts)
  @IsNumber()
  @Min(1)
  valorFgts?: number;

  @IsNumber()
  @Min(0)
  @Max(30)
  taxaJurosAnual: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;
}
