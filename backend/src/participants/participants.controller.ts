import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { ParticipantsService } from './participants.service';

@Controller('processes/:processId/participants')
export class ParticipantsController {
  constructor(private readonly service: ParticipantsService) {}

  @Get()
  @Roles('dono', 'analista', 'cliente')
  findAll(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.findAll(processId, req.user);
  }

  @Post()
  @Roles('dono', 'analista')
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: CreateParticipantDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.create(processId, dto, req.user);
  }

  @Delete(':id')
  @Roles('dono', 'analista')
  remove(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.remove(processId, id, req.user);
  }
}
