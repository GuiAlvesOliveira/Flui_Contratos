import { IsIn, IsOptional, Matches } from 'class-validator';

/** ?days= dos relatórios (PROD-03): o serviço mantém entre 1 e 365 (padrão 30). */
export class ReportQueryDto {
  @IsOptional()
  @Matches(/^\d{1,4}$/, { message: 'days deve ser um número de dias' })
  days?: string;
}

export class ReportExportQueryDto extends ReportQueryDto {
  @IsIn(['xlsx', 'pdf'], { message: 'format deve ser xlsx ou pdf' })
  format: 'xlsx' | 'pdf';
}

/** ?year= do relatório de success fee (PROD-09); padrão: o ano atual. */
export class SuccessFeeQueryDto {
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'year deve ser um ano com 4 dígitos' })
  year?: string;
}
