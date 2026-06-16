import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateEmpreendimentoDto } from './dto/create-empreendimento.dto';
import { UpdateEmpreendimentoDto } from './dto/update-empreendimento.dto';
import { EmpreendimentosService } from './empreendimentos.service';

@Controller('empreendimentos')
export class EmpreendimentosController {
  constructor(private readonly service: EmpreendimentosService) {}

  @Post()
  @Roles('dono', 'analista')
  create(@Body() dto: CreateEmpreendimentoDto, @Request() req: { user: RequestUserFull }) {
    return this.service.create(dto, req.user);
  }

  @Get()
  @Roles('dono', 'analista')
  findAll(@Request() req: { user: RequestUserFull }) {
    return this.service.findAll(req.user);
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
    @Body() dto: UpdateEmpreendimentoDto,
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
