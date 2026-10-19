import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

export const TASK_STATUSES = ['a_fazer', 'em_andamento', 'concluida'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_DUE_FILTERS = ['atrasadas', 'hoje', 'semana'] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
// Descrição em branco vira null (o campo é opcional)
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day, YYYY-MM-DD, between 2000 and 2100. */
export function IsCalendarDay(options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isCalendarDay',
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
          const d = new Date(`${value}T00:00:00Z`);
          // Rejects impossible days that Date would roll over (e.g. 2026-02-30)
          if (
            Number.isNaN(d.getTime()) ||
            d.toISOString().slice(0, 10) !== value
          ) {
            return false;
          }
          return value >= '2000-01-01' && value <= '2100-12-31';
        },
        defaultMessage: () => 'Informe uma data válida (AAAA-MM-DD)',
      },
    },
    options,
  );
}

/**
 * POST /tasks (PROD-01). Autor, assessoria e datas de controle vêm do servidor;
 * qualquer outro campo é recusado (forbidNonWhitelisted). O responsável só é
 * escolhido pelo gestor — para o analista, a tarefa é sempre dele.
 */
export class CreateTaskDto {
  @Transform(trim)
  @IsString({ message: 'Informe o título da tarefa' })
  @MinLength(3, { message: 'O título precisa de pelo menos 3 caracteres' })
  @MaxLength(200, { message: 'O título pode ter no máximo 200 caracteres' })
  title: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000, {
    message: 'A descrição pode ter no máximo 2000 caracteres',
  })
  description?: string | null;

  @IsCalendarDay({ message: 'Informe o prazo (data válida)' })
  dueDate: string;

  @IsOptional()
  @IsUUID('all', { message: 'Processo inválido' })
  processId?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Responsável inválido' })
  assigneeId?: string;
}

/** PATCH /tasks/:id — só o que foi enviado muda; processId null desvincula. */
export class UpdateTaskDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'O título precisa de pelo menos 3 caracteres' })
  @MaxLength(200, { message: 'O título pode ter no máximo 200 caracteres' })
  title?: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(2000, {
    message: 'A descrição pode ter no máximo 2000 caracteres',
  })
  description?: string | null;

  @IsOptional()
  @IsCalendarDay({ message: 'Informe o prazo (data válida)' })
  dueDate?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES, { message: 'Status inválido' })
  status?: TaskStatus;

  @IsOptional()
  @IsUUID('all', { message: 'Processo inválido' })
  processId?: string | null;

  @IsOptional()
  @IsUUID('all', { message: 'Responsável inválido' })
  assigneeId?: string;
}

/** GET /tasks — filtros da lista e intervalo do calendário. */
export class ListTasksQueryDto {
  @IsOptional()
  @IsUUID('all')
  assigneeId?: string;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsIn(TASK_DUE_FILTERS)
  due?: TaskDueFilter;

  @IsOptional()
  @IsUUID('all')
  processId?: string;

  @IsOptional()
  @IsCalendarDay()
  from?: string;

  @IsOptional()
  @IsCalendarDay()
  to?: string;
}
