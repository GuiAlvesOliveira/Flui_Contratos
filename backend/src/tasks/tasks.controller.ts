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
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { TasksService } from './tasks.service';

// PROD-01: tarefas da equipe. O cliente não acessa (403 em todas as rotas);
// o serviço aplica o resto: analista só as dele, gestor vê e reatribui todas.
@Controller('tasks')
@Roles('dono', 'analista')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  list(
    @Query() query: ListTasksQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.list(req.user, query);
  }

  // Declarada antes de ':id' para não cair nela
  @Get('assignees')
  assignees(@Request() req: { user: RequestUserFull }) {
    return this.service.assignees(req.user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.findOne(id, req.user);
  }

  @Post()
  create(
    @Body() dto: CreateTaskDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.create(dto, req.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.remove(id, req.user);
  }
}
