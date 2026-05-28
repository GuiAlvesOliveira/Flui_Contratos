import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { Process } from '../processes/process.entity';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { ProcessParticipant } from './participant.entity';

@Injectable()
export class ParticipantsService {
  constructor(
    @InjectRepository(ProcessParticipant) private readonly repo: Repository<ProcessParticipant>,
    @InjectRepository(Process) private readonly processRepo: Repository<Process>,
  ) {}

  private async assertProcess(processId: string, caller: RequestUserFull): Promise<Process> {
    const process = await this.processRepo.findOne({
      where: { id: processId, tenantId: caller.tenantId! },
    });
    if (!process) throw new NotFoundException('Processo não encontrado');
    if (caller.role === 'cliente' && process.clientId !== caller.userId) {
      throw new ForbiddenException();
    }
    return process;
  }

  async findAll(processId: string, caller: RequestUserFull) {
    await this.assertProcess(processId, caller);
    return this.repo.find({
      where: { processId, tenantId: caller.tenantId! },
      order: { createdAt: 'ASC' },
    });
  }

  async create(processId: string, dto: CreateParticipantDto, caller: RequestUserFull) {
    await this.assertProcess(processId, caller);
    const participant = this.repo.create({
      processId,
      tenantId: caller.tenantId!,
      name: dto.name,
      cpf: dto.cpf ?? null,
      declaredIncome: dto.declaredIncome,
    });
    return this.repo.save(participant);
  }

  async remove(processId: string, participantId: string, caller: RequestUserFull) {
    await this.assertProcess(processId, caller);
    const participant = await this.repo.findOne({
      where: { id: participantId, processId, tenantId: caller.tenantId! },
    });
    if (!participant) throw new NotFoundException('Participante não encontrado');
    await this.repo.remove(participant);
    return { id: participantId };
  }
}
