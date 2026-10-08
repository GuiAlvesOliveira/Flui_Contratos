import { Controller, Get, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { SummaryQueryDto } from './dto/summary-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // BE-14: indicadores do dashboard (?days=30), com cache de 5 minutos
  @Get('summary')
  @Roles('dono', 'analista')
  summary(
    @Query() query: SummaryQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.summary(req.user, query.days);
  }
}
