import { Module } from '@nestjs/common';
import { ProcessesModule } from '../processes/processes.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [ProcessesModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
