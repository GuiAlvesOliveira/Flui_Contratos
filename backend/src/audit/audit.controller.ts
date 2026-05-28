import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  @Roles('dono')
  findAll(
    @Request() req: { user: RequestUserFull },
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return this.service.findAll(req.user, +limit, +offset);
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
