import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AdvanceStageDto } from './dto/advance-stage.dto';
import { CreateProcessDto } from './dto/create-process.dto';
import { UpdateProcessDto } from './dto/update-process.dto';
import type { ProcessStage } from './process.entity';
import { ProcessesService } from './processes.service';

@Controller('processes')
export class ProcessesController {
  constructor(private readonly service: ProcessesService) {}

  @Post()
  @Roles('dono', 'analista')
  create(@Body() dto: CreateProcessDto, @Request() req: { user: RequestUserFull }) {
    return this.service.create(dto, req.user);
  }

  @Get()
  @Roles('dono', 'analista', 'cliente')
  findAll(
    @Request() req: { user: RequestUserFull },
    @Query('stage') stage?: ProcessStage,
    @Query('empreendimentoId') empreendimentoId?: string,
  ) {
    return this.service.findAll(req.user, stage, empreendimentoId);
  }

  // BE-17: relatório CSV (declarado antes de ':id' para não cair nele)
  @Get('export')
  @Roles('dono')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async exportCsv(
    @Request() req: { user: RequestUserFull },
    @Res({ passthrough: true }) res: Response,
  ) {
    const csv = await this.service.exportCsv(req.user);
    const day = new Date().toLocaleDateString('sv-SE', {
      timeZone: 'America/Sao_Paulo',
    });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="processos-${day}.csv"`,
    );
    return csv;
  }

  @Get(':id')
  @Roles('dono', 'analista', 'cliente')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: RequestUserFull }) {
    return this.service.findOne(id, req.user);
  }

  @Get(':id/income-composition')
  @Roles('dono', 'analista', 'cliente')
  getIncomeComposition(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.getIncomeComposition(id, req.user);
  }

  @Patch(':id')
  @Roles('dono', 'analista')
  updateFields(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProcessDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.updateFields(id, dto, req.user);
  }

  @Patch(':id/stage')
  @Roles('dono', 'analista')
  advanceStage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdvanceStageDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.advanceStage(id, dto, req.user);
  }

  @Delete(':id')
  @Roles('dono')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: RequestUserFull }) {
    return this.service.deactivate(id, req.user);
  }

  @Get(':id/audit')
  @Roles('dono', 'analista', 'cliente')
  getAuditLog(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: RequestUserFull }) {
    return this.service.getAuditLog(id, req.user);
  }
}
