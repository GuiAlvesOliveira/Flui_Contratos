import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Os valores de cada bloco são validados campo a campo pelo FichaService
// (ficha-fields.ts); aqui só a forma do corpo.
export class PatchFichaDto {
  @IsOptional()
  @IsObject()
  cliente?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  segundo?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  processo?: Record<string, unknown>;
}

export class CreateDataRequestDto {
  @IsArray()
  @ArrayMaxSize(80)
  @IsString({ each: true })
  fields: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AnswerDataRequestDto {
  @IsObject()
  values: Record<string, unknown>;
}
