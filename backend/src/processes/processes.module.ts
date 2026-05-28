import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from '../documents/documents.module';
import { WebhookService } from '../common/services/webhook.service';
import { User } from '../users/user.entity';
import { ProcessesController } from './processes.controller';
import { ProcessesService } from './processes.service';
import { Process } from './process.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Process, User]), DocumentsModule],
  controllers: [ProcessesController],
  providers: [ProcessesService, WebhookService],
})
export class ProcessesModule {}
