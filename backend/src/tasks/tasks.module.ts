import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

// PROD-01: tarefas da assessoria (página Tarefas e Calendário).
@Module({
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
