import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
} from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

// FE-29: painel de notificações da topbar
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @Roles('dono', 'analista', 'cliente')
  list(@Request() req: { user: RequestUserFull }) {
    return this.service.list(req.user);
  }

  // declarado antes de ':id/read'
  @Post('read-all')
  @HttpCode(200)
  @Roles('dono', 'analista', 'cliente')
  markAllRead(@Request() req: { user: RequestUserFull }) {
    return this.service.markAllRead(req.user);
  }

  @Post(':id/read')
  @HttpCode(200)
  @Roles('dono', 'analista', 'cliente')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.markRead(id, req.user);
  }
}
