import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsBirthDate } from '../../common/decorators/is-birth-date.decorator';
import {
  ESTADOS_CIVIS,
  FONTES_RENDA,
  type EstadoCivil,
  type FonteRenda,
} from '../../common/civil-status';

export class OnboardingDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  surname?: string;

  @IsOptional()
  @IsString()
  telefone?: string;

  @IsOptional()
  @IsString()
  @Length(11, 14)
  cpf?: string;

  @IsOptional()
  @IsString()
  rg?: string;

  @IsOptional()
  @IsBirthDate()
  dataNascimento?: string;

  // PROD-06: 00000-000 or 8 digits; stored as digits
  @IsOptional()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter 8 dígitos' })
  cep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  endereco?: string;

  // Ficha do cliente: antes eram pedidos na tela e descartados
  @IsOptional()
  @IsIn(ESTADOS_CIVIS)
  estadoCivil?: EstadoCivil;

  @IsOptional()
  @IsIn(FONTES_RENDA)
  fonteRenda?: FonteRenda;
}
