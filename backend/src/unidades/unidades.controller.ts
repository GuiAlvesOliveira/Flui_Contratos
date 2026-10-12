import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateUnidadeDto } from './dto/create-unidade.dto';
import { UpdateUnidadeDto } from './dto/update-unidade.dto';
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

  @Patch(':id')
  @Roles('dono', 'analista')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnidadeDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  @Roles('dono')
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: { user: RequestUserFull }) {
    return this.service.remove(id, req.user);
  }
}
