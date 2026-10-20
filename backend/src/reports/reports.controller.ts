import {
  Controller,
  Get,
  Header,
  Query,
  Request,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ReportExportQueryDto,
  ReportQueryDto,
  SuccessFeeQueryDto,
} from './dto/report-query.dto';
import { ReportsService } from './reports.service';

// PROD-03: relatórios só do gestor — analista e cliente recebem 403.
@Controller('reports')
@Roles('dono')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Get('ranking')
  ranking(
    @Query() query: ReportQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.ranking(req.user, query.days);
  }

  // Excel ou PDF com os mesmos números da tela
  @Get('export')
  async export(
    @Query() query: ReportExportQueryDto,
    @Request() req: { user: RequestUserFull },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, fileName, contentType } = await this.service.export(
      req.user,
      query.format,
      query.days,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file);
  }

  // PROD-09: contratos assinados, comissão e success fee devido, por mês
  @Get('success-fee')
  successFee(
    @Query() query: SuccessFeeQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.successFee(req.user, query.year);
  }

  @Get('success-fee/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async successFeeExport(
    @Query() query: SuccessFeeQueryDto,
    @Request() req: { user: RequestUserFull },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { csv, fileName } = await this.service.successFeeExport(
      req.user,
      query.year,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return csv;
  }
}
