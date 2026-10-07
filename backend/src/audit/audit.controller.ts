import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @Roles('dono')
  findAll(
    @Request() req: { user: RequestUserFull },
    @Query() query: ListAuditLogsDto,
  ) {
    const { limit = '50', offset = '0', processId, action, from, to } = query;
    return this.service.findAll(req.user, +limit, +offset, {
      processId,
      action,
      from,
      to,
    });
  }

  @Post(':id/undo')
  @Roles('dono')
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.undo(id, req.user);
  }
}
