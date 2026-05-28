import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AdvanceStageDto } from './dto/advance-stage.dto';
import { CreateProcessDto } from './dto/create-process.dto';
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

  @Get(':id')
  @Roles('dono', 'analista', 'cliente')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: RequestUserFull }) {
    return this.service.findOne(id, req.user);
  }

  @Patch(':id')
  @Roles('dono', 'analista')
  updateFields(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.updateFields(id, dto as Parameters<typeof this.service.updateFields>[1], req.user);
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
