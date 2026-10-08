import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** POST /processes/:processId/documents/request — entries picked from the catalog (BE-03). */
export class RequestDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  documentTypeIds: string[];
}

/** DELETE /documents/:docId query — complete removal (BE-10, LGPD). */
export class RemoveDocumentQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  // Process being viewed, to attach the audit entry of a personal document
  @IsOptional()
  @IsUUID()
  processId?: string;
}
