import { Controller, Get, Request } from '@nestjs/common';
import { RequestUserFull } from '../auth/supabase.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DocumentExpiryService } from './document-expiry.service';

@Controller('document-expiry')
export class DocumentExpiryController {
  constructor(private readonly service: DocumentExpiryService) {}

  // Painel: processos com documento vencendo ou vencido (analista: os dele)
  @Get('processes')
  @Roles('dono', 'analista')
  processes(@Request() req: { user: RequestUserFull }) {
    return this.service.processes(req.user);
  }

  // Portal do cliente: os próprios documentos vencendo ou vencidos
  @Get('mine')
  @Roles('cliente')
  mine(@Request() req: { user: RequestUserFull }) {
    return this.service.mine(req.user);
  }
}
