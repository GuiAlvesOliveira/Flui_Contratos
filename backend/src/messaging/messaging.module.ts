import { Global, Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { OutboxWorker } from './outbox.worker';

// BE-09_v2: in-house messaging (outbox + worker), available to every module.
@Global()
@Module({
  providers: [MessagingService, OutboxWorker],
  exports: [MessagingService],
})
export class MessagingModule {}
