import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query string of GET /audit-logs (BE-07).
 * limit/offset stay free-form strings: AuditService clamps them (SEC-07), so an
 * out-of-range value is corrected instead of rejected, as before the filters.
 * from/to are calendar days (YYYY-MM-DD) in the assessoria's time zone
 * (America/Sao_Paulo), both inclusive.
 */
export class ListAuditLogsDto {
  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;

  @IsOptional()
  @IsUUID()
  processId?: string;

  @IsOptional()
  @Matches(/^[a-z_]{1,100}$/, { message: 'action inválida' })
  action?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from deve estar no formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'from não é uma data válida' })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to deve estar no formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'to não é uma data válida' })
  to?: string;
}
