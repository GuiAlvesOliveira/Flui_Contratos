import {
  Controller,
  Get,
  Query,
  Request,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ReportExportQueryDto, ReportQueryDto } from './dto/report-query.dto';
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
}
