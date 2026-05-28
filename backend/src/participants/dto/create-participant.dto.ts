import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateParticipantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  cpf?: string;

  @IsNumber()
  @Min(0)
  declaredIncome: number;
}
