import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// PROD-03: página Relatórios do gestor (ranking e exportação em Excel/PDF).
@Module({
  imports: [DashboardModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
