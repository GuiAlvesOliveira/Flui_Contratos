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

  // `disponivel` is false while a process is under way on the unidade (FE-26).
  // Inactive and credit-refused processes free it up again.
  async findByEmpreendimento(
    empreendimentoId: string,
    caller: RequestUserFull,
  ) {
    const unidades = await this.repo.find({
      where: { empreendimentoId, tenantId: caller.tenantId! },
    });
    if (unidades.length === 0) return [];

    const rows = await this.dataSource.query<{ unidade_id: string }[]>(
      `SELECT DISTINCT unidade_id FROM processes
        WHERE tenant_id = $1 AND unidade_id = ANY($2::uuid[]) AND active = true
          AND stage NOT IN ('cliente_inativo', 'credito_recusado')`,
      [caller.tenantId, unidades.map((u) => u.id)],
    );
    const ocupadas = new Set(rows.map((r) => r.unidade_id));
    return unidades.map((u) => ({ ...u, disponivel: !ocupadas.has(u.id) }));
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
