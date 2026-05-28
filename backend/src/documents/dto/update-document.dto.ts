import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateDocumentDto {
  @IsOptional()
  @IsIn(['pendente', 'recebido', 'validado', 'rejeitado'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  validatedByNotes?: string;
}
