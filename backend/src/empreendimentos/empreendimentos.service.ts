import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { Empreendimento } from './empreendimento.entity';
import { CreateEmpreendimentoDto } from './dto/create-empreendimento.dto';
import { UpdateEmpreendimentoDto } from './dto/update-empreendimento.dto';

export type EmpreendimentoStatus =
  | 'em_andamento'
  | 'concluido'
  | 'sem_processos';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface ProcessCountRow {
  empreendimento_id: string;
  total: string;
  em_andamento: string;
  concluidos: string;
}

// em_andamento: at least one process still moving through the pipeline;
// concluido: none in progress and at least one signed (assinatura);
// sem_processos: nothing in progress or signed (no process, or only inactive).
export function empreendimentoStatus(
  emAndamento: number,
  concluidos: number,
): EmpreendimentoStatus {
  if (emAndamento > 0) return 'em_andamento';
  if (concluidos > 0) return 'concluido';
  return 'sem_processos';
}

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

  // Each empreendimento comes with its process counts and a derived status, so
  // the list can show and filter them without loading every process. Counts
  // follow GET /processes visibility: an analista only counts their own.
  async findAll(caller: RequestUserFull) {
    const emps = await this.repo.find({
      where: { tenantId: caller.tenantId!, active: true },
    });
    if (emps.length === 0) return [];

    const params: string[] = [caller.tenantId!];
    let analistaFilter = '';
    if (caller.role === 'analista') {
      params.push(caller.userId);
      analistaFilter = 'AND p.analista_id = $2';
    }
    const rows = await this.dataSource.query<ProcessCountRow[]>(
      `SELECT u.empreendimento_id AS empreendimento_id,
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE p.stage NOT IN ('assinatura', 'cliente_inativo')) AS em_andamento,
              COUNT(*) FILTER (WHERE p.stage = 'assinatura') AS concluidos
       FROM processes p
       JOIN unidades u ON u.id = p.unidade_id
       WHERE p.tenant_id = $1 AND p.active = true ${analistaFilter}
       GROUP BY u.empreendimento_id`,
      params,
    );
    const byEmp = new Map(rows.map((r) => [r.empreendimento_id, r]));

    return emps.map((emp) => {
      const row = byEmp.get(emp.id);
      const processCount = Number(row?.total ?? 0);
      const processosEmAndamento = Number(row?.em_andamento ?? 0);
      const processosConcluidos = Number(row?.concluidos ?? 0);
      return {
        ...emp,
        processCount,
        processosEmAndamento,
        processosConcluidos,
        status: empreendimentoStatus(processosEmAndamento, processosConcluidos),
      };
    });
  }

  async findOne(id: string, caller: RequestUserFull) {
    const emp = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!emp) throw new NotFoundException('Empreendimento não encontrado');
    return emp;
  }

  // FE-27: analistas assigned to the empreendimento. Add and remove return the
  // updated team so the page can show it right away.
  async listTeam(id: string, caller: RequestUserFull): Promise<TeamMember[]> {
    await this.findOne(id, caller);
    return this.dataSource.query<TeamMember[]>(
      `SELECT u.id, u.name, u.email, u.role
         FROM empreendimento_team t
         JOIN users u ON u.id = t.user_id
        WHERE t.empreendimento_id = $1 AND t.tenant_id = $2
        ORDER BY u.name NULLS LAST, u.email`,
      [id, caller.tenantId],
    );
  }

  async addTeamMember(id: string, userId: string, caller: RequestUserFull) {
    await this.findOne(id, caller);
    const [user] = await this.dataSource.query<
      { id: string; role: string; status: string }[]
    >(`SELECT id, role, status FROM users WHERE id = $1 AND tenant_id = $2`, [
      userId,
      caller.tenantId,
    ]);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.role !== 'analista') {
      throw new BadRequestException('Só analistas fazem parte da equipe');
    }
    if (user.status === 'disabled') {
      throw new BadRequestException('Usuário desativado');
    }
    await this.dataSource.query(
      `INSERT INTO empreendimento_team (tenant_id, empreendimento_id, user_id, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (empreendimento_id, user_id) DO NOTHING`,
      [caller.tenantId, id, userId, caller.userId],
    );
    return this.listTeam(id, caller);
  }

  async removeTeamMember(id: string, userId: string, caller: RequestUserFull) {
    await this.findOne(id, caller);
    await this.dataSource.query(
      `DELETE FROM empreendimento_team
        WHERE empreendimento_id = $1 AND user_id = $2 AND tenant_id = $3`,
      [id, userId, caller.tenantId],
    );
    return this.listTeam(id, caller);
  }

  async update(id: string, dto: UpdateEmpreendimentoDto, caller: RequestUserFull) {
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
