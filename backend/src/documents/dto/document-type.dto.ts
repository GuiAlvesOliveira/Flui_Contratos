import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
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

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
