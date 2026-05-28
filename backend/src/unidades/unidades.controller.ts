import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUnidadeDto } from './dto/create-unidade.dto';
import { UnidadesService } from './unidades.service';

@Controller('unidades')
export class UnidadesController {
  constructor(private readonly service: UnidadesService) {}

  @Post()
  @Roles('dono', 'analista')
  create(@Body() dto: CreateUnidadeDto, @Request() req: { user: RequestUserFull }) {
    return this.service.create(dto, req.user);
  }

  @Get()
  @Roles('dono', 'analista')
  findByEmpreendimento(
    @Query('empreendimentoId', ParseUUIDPipe) empreendimentoId: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.findByEmpreendimento(empreendimentoId, req.user);
  }

  @Get(':id')
  @Roles('dono', 'analista')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: RequestUserFull }) {
    return this.service.findOne(id, req.user);
  }

  @Delete(':id')
  @Roles('dono')
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: RequestUserFull }) {
    return this.service.remove(id, req.user);
  }
}
