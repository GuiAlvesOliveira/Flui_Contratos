import { Module } from '@nestjs/common';
import { DocumentExpiryController } from './document-expiry.controller';
import { DocumentExpiryJob } from './document-expiry.job';
import { DocumentExpiryService } from './document-expiry.service';

// Validade de documentos pelo mês de referência: rotina diária de avisos
// (só dentro da plataforma, tabela notifications) e listas do painel/portal.
@Module({
  controllers: [DocumentExpiryController],
  providers: [DocumentExpiryService, DocumentExpiryJob],
})
export class DocumentExpiryModule {}
