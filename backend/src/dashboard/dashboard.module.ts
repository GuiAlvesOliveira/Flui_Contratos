import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
  // PROD-03: os relatórios reaproveitam o mesmo resumo (e o mesmo cache)
  exports: [DashboardService],
})
export class DashboardModule {}
