import { Controller, Get, Query, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { SummaryQueryDto } from './dto/summary-query.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // BE-14: indicadores do dashboard (?days=30), com cache de 5 minutos.
  // PROD-10: inclui o prazo de atendimento (sla) do mesmo recorte.
  @Get('summary')
  @Roles('dono', 'analista')
  summary(
    @Query() query: SummaryQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.summary(req.user, query.days);
  }

  // PROD-10: prazo e tempos de análise de cada analista — só o gestor
  @Get('analistas')
  @Roles('dono')
  analistas(
    @Query() query: SummaryQueryDto,
    @Request() req: { user: RequestUserFull },
  ) {
    return this.service.byAnalista(req.user, query.days);
  }
}
