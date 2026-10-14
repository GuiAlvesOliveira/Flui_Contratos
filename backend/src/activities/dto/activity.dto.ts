import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const ACTIVITY_MIN_LENGTH = 3;
export const ACTIVITY_MAX_LENGTH = 2000;

/**
 * POST and PATCH /processes/:processId/activities — the description is the only
 * field the analista fills in. Date, time, stage and author come from the
 * server; any other field in the body is rejected (forbidNonWhitelisted).
 */
export class ActivityDescriptionDto {
  @Transform(trim)
  @IsString({ message: 'Descreva a atividade realizada' })
  @MinLength(ACTIVITY_MIN_LENGTH, {
    message: `Descreva a atividade com pelo menos ${ACTIVITY_MIN_LENGTH} caracteres`,
  })
  @MaxLength(ACTIVITY_MAX_LENGTH, {
    message: `A descrição pode ter no máximo ${ACTIVITY_MAX_LENGTH} caracteres`,
  })
  description: string;
}

/** DELETE /processes/:processId/activities/:id?reason=... */
export class RemoveActivityQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500, { message: 'O motivo pode ter no máximo 500 caracteres' })
  reason?: string;
}
