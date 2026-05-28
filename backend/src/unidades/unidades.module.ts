import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Unidade } from './unidade.entity';
import { UnidadesController } from './unidades.controller';
import { UnidadesService } from './unidades.service';

@Module({
  imports: [TypeOrmModule.forFeature([Unidade])],
  controllers: [UnidadesController],
  providers: [UnidadesService],
  exports: [UnidadesService],
})
export class UnidadesModule {}
