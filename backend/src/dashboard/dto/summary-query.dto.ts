import { IsOptional, Matches } from 'class-validator';

/**
 * Query string of GET /dashboard/summary (BE-14). `days` stays text: the
 * service keeps it between 1 and 365 (default 30).
 */
export class SummaryQueryDto {
  @IsOptional()
  @Matches(/^\d{1,4}$/, { message: 'days deve ser um número de dias' })
  days?: string;
}
