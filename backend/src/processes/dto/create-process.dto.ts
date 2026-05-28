import { IsNumber, IsOptional, IsUUID } from 'class-validator';

export class CreateProcessDto {
  @IsUUID()
  clientId: string;

  @IsOptional() @IsUUID()
  analistaId?: string;

  @IsOptional() @IsUUID()
  unidadeId?: string;

  @IsOptional() @IsNumber()
  valorUnidade?: number;

  @IsOptional() @IsNumber()
  valorEmAberto?: number;
}
