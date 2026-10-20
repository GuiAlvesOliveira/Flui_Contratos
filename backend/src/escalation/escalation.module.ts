import { Module } from '@nestjs/common';
import { EscalationJob } from './escalation.job';
import { EscalationService } from './escalation.service';

// PROD-05_v2: alerta diário de processos parados (e-mail pela message_outbox).
@Module({
  providers: [EscalationService, EscalationJob],
})
export class EscalationModule {}
