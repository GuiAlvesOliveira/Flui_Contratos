import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  surname?: string;

  @IsIn(['dono', 'analista', 'cliente'])
  role: 'dono' | 'analista' | 'cliente';

  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  @Length(11, 14)
  cpf?: string;
}
