import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AzureStorageService } from '../common/services/azure-storage.service';
import { EmailModule } from '../email/email.module';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { Document } from './document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [TypeOrmModule.forFeature([Document, Process, User]), EmailModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, AzureStorageService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
