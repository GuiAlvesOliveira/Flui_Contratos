import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { Empreendimento } from './empreendimento.entity';
import { CreateEmpreendimentoDto } from './dto/create-empreendimento.dto';

@Injectable()
export class EmpreendimentosService {
  constructor(
    @InjectRepository(Empreendimento)
    private readonly repo: Repository<Empreendimento>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateEmpreendimentoDto, caller: RequestUserFull) {
    const emp = this.repo.create({
      tenantId: caller.tenantId!,
      nome: dto.nome,
      matriculaMae: dto.matriculaMae,
      endereco: dto.endereco,
      cep: dto.cep,
      bancoFinanciador: dto.bancoFinanciador,
      construtoraInfo: dto.construtoraInfo ?? null,
      incorporadoraContato: dto.incorporadoraContato ?? null,
    });
    return this.repo.save(emp);
  }

  findAll(caller: RequestUserFull) {
    return this.repo.find({ where: { tenantId: caller.tenantId!, active: true } });
  }

  async findOne(id: string, caller: RequestUserFull) {
    const emp = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!emp) throw new NotFoundException('Empreendimento não encontrado');
    return emp;
  }

  async update(id: string, dto: Partial<CreateEmpreendimentoDto>, caller: RequestUserFull) {
    const emp = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!emp) throw new NotFoundException('Empreendimento não encontrado');
    Object.assign(emp, dto);
    return this.repo.save(emp);
  }

  async remove(id: string, caller: RequestUserFull) {
    const emp = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!emp) throw new NotFoundException('Empreendimento não encontrado');

    const [{ count }] = await this.dataSource.query<[{ count: string }]>(
      `SELECT COUNT(*) AS count FROM processes p
       JOIN unidades u ON u.id = p.unidade_id
       WHERE u.empreendimento_id = $1 AND p.active = true`,
      [id],
    );
    if (Number(count) > 0) {
      throw new BadRequestException('Empreendimento possui processos ativos');
    }

    emp.active = false;
    await this.repo.save(emp);
    return { id, deleted: true };
  }
}
