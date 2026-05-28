import { IsOptional, IsString, Length, MinLength } from 'class-validator';

export class CreateEmpreendimentoDto {
  @IsString() @MinLength(1)
  nome: string;

  @IsString() @MinLength(1)
  matriculaMae: string;

  @IsString() @MinLength(1)
  endereco: string;

  @IsString() @Length(8, 10)
  cep: string;

  @IsString() @MinLength(1)
  bancoFinanciador: string;

  @IsOptional() @IsString()
  construtoraInfo?: string;

  @IsOptional() @IsString()
  incorporadoraContato?: string;
}
