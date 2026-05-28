import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { Unidade } from './unidade.entity';
import { CreateUnidadeDto } from './dto/create-unidade.dto';

@Injectable()
export class UnidadesService {
  constructor(
    @InjectRepository(Unidade) private readonly repo: Repository<Unidade>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateUnidadeDto, caller: RequestUserFull) {
    const unidade = this.repo.create({
      tenantId: caller.tenantId!,
      empreendimentoId: dto.empreendimentoId,
      identificacao: dto.identificacao,
      valor: dto.valor ?? null,
    });
    return this.repo.save(unidade);
  }

  findByEmpreendimento(empreendimentoId: string, caller: RequestUserFull) {
    return this.repo.find({
      where: { empreendimentoId, tenantId: caller.tenantId! },
    });
  }

  async findOne(id: string, caller: RequestUserFull) {
    const u = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!u) throw new NotFoundException('Unidade não encontrada');
    return u;
  }

  async remove(id: string, caller: RequestUserFull) {
    const u = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!u) throw new NotFoundException('Unidade não encontrada');

    const [{ count }] = await this.dataSource.query<[{ count: string }]>(
      `SELECT COUNT(*) AS count FROM processes WHERE unidade_id = $1 AND active = true`,
      [id],
    );
    if (Number(count) > 0) {
      throw new BadRequestException('Unidade possui processo ativo');
    }

    await this.repo.delete(id);
    return { id, deleted: true };
  }
}
