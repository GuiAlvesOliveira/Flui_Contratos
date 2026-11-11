import { Global, Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { OutboxAdminService } from './outbox-admin.service';
import { OutboxWorker } from './outbox.worker';

// BE-09_v2: in-house messaging (outbox + worker), available to every module.
// OutboxAdminService is what the gestor uses to control the sending.
@Global()
@Module({
  controllers: [MessagingController],
  providers: [MessagingService, OutboxWorker, OutboxAdminService],
  exports: [MessagingService, OutboxAdminService],
})
export class MessagingModule {}
