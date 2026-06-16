import { IsOptional, IsString, Length, MinLength } from 'class-validator';

/**
 * Whitelist for PATCH /empreendimentos/:id.
 * Mirrors CreateEmpreendimentoDto with every field optional. Intentionally
 * excludes tenantId and active so they cannot be reassigned cross-tenant via a
 * field update (mass-assignment guard, SEC-01).
 */
export class UpdateEmpreendimentoDto {
  @IsOptional() @IsString() @MinLength(1)
  nome?: string;

  @IsOptional() @IsString() @MinLength(1)
  matriculaMae?: string;

  @IsOptional() @IsString() @MinLength(1)
  endereco?: string;

  @IsOptional() @IsString() @Length(8, 10)
  cep?: string;

  @IsOptional() @IsString() @MinLength(1)
  bancoFinanciador?: string;

  @IsOptional() @IsString()
  construtoraInfo?: string;

  @IsOptional() @IsString()
  incorporadoraContato?: string;
}
