import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ActivitiesService } from './activities.service';
import {
  ActivityDescriptionDto,
  RemoveActivityQueryDto,
} from './dto/activity.dto';

// Histórico de Atividades of a process. The service applies the finer rules:
// only the process's analista creates; the author (24 h) or the gestor (any
// time) edits; the author (24 h) or the gestor (with a reason) removes.
@Controller('processes/:processId/activities')
export class ActivitiesController {
  constructor(private readonly service: ActivitiesService) {}

  @Get()
  @Roles('dono', 'analista', 'cliente')
  list(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.list(processId, req.user);
  }

  @Post()
  @Roles('analista')
  create(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() dto: ActivityDescriptionDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.create(processId, dto.description, req.user);
  }

  @Patch(':id')
  @Roles('dono', 'analista')
  update(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivityDescriptionDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.update(processId, id, dto.description, req.user);
  }

  @Delete(':id')
  @Roles('dono', 'analista')
  remove(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RemoveActivityQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.remove(
      processId,
      id,
      query.reason || undefined,
      req.user,
    );
  }
}
