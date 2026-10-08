import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
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

  // FE-27: equipe do empreendimento — todos veem, só o gestor altera
  @Get(':id/team')
  @Roles('dono', 'analista')
  listTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.listTeam(id, req.user);
  }

  @Post(':id/team')
  @Roles('dono')
  addTeamMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTeamMemberDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.addTeamMember(id, dto.userId, req.user);
  }

  @Delete(':id/team/:userId')
  @Roles('dono')
  removeTeamMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.removeTeamMember(id, userId, req.user);
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
