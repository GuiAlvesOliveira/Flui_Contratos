import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_VALIDITY_MONTHS } from '../document-validity';
import { DOCUMENT_CATEGORIES } from '../document-type.entity';
import type { DocumentCategory } from '../document-type.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** POST /document-types — new entry of the assessoria's catalog (BE-03). */
export class CreateDocumentTypeDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  label: string;

  @IsIn(DOCUMENT_CATEGORIES)
  category: DocumentCategory;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  // prazo de validade em meses a partir do mês de referência; vazio = sem prazo
  @IsOptional()
  @IsInt({ message: 'a validade deve ser um número inteiro de meses' })
  @Min(1, { message: 'a validade deve ser de 1 a 120 meses' })
  @Max(MAX_VALIDITY_MONTHS, { message: 'a validade deve ser de 1 a 120 meses' })
  validityMonths?: number;
}

/** PATCH /document-types/:id — edit or (de)activate a catalog entry. */
export class UpdateDocumentTypeDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  label?: string;

  @IsOptional()
  @IsIn(DOCUMENT_CATEGORIES)
  category?: DocumentCategory;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  // null tira o prazo (o tipo deixa de pedir mês de referência)
  @IsOptional()
  @IsInt({ message: 'a validade deve ser um número inteiro de meses' })
  @Min(1, { message: 'a validade deve ser de 1 a 120 meses' })
  @Max(MAX_VALIDITY_MONTHS, { message: 'a validade deve ser de 1 a 120 meses' })
  validityMonths?: number | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
