import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empreendimento } from './empreendimento.entity';
import { EmpreendimentosController } from './empreendimentos.controller';
import { EmpreendimentosService } from './empreendimentos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Empreendimento])],
  controllers: [EmpreendimentosController],
  providers: [EmpreendimentosService],
  exports: [EmpreendimentosService],
})
export class EmpreendimentosModule {}
