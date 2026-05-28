import { IsOptional, IsString, Length, MinLength } from 'class-validator';

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
}
