import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AzureStorageService } from '../common/services/azure-storage.service';
import { WebhookService } from '../common/services/webhook.service';
import { EmailModule } from '../email/email.module';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { Document } from './document.entity';
import { DocumentType } from './document-type.entity';
import { DocumentTypesController } from './document-types.controller';
import { DocumentTypesService } from './document-types.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, DocumentType, Process, User]),
    EmailModule,
  ],
  controllers: [DocumentsController, DocumentTypesController],
  providers: [
    DocumentsService,
    DocumentTypesService,
    AzureStorageService,
    WebhookService,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
