import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { DocumentsService } from '../documents/documents.service';
import { EmailService } from '../email/email.service';
import { WebhookService } from '../common/services/webhook.service';
import { User } from '../users/user.entity';
import { AdvanceStageDto } from './dto/advance-stage.dto';
import { CreateProcessDto } from './dto/create-process.dto';
import { Process, ProcessStage } from './process.entity';

// Ordered linear progression — side stages (cliente_inativo, credito_recusado,
// processo_pendencia) are excluded; moving to them never triggers the doc gate.
const LINEAR_STAGES: ProcessStage[] = [
  'inicial', 'cadastro', 'analise_credito', 'credito_aprovado',
  'analise_juridica', 'juridico_aprovado', 'cartorio', 'assinatura',
];

function isForwardMove(from: ProcessStage, to: ProcessStage): boolean {
  const fi = LINEAR_STAGES.indexOf(from);
  const ti = LINEAR_STAGES.indexOf(to);
  return fi >= 0 && ti > fi;
}

@Injectable()
export class ProcessesService {
  constructor(
    @InjectRepository(Process) private readonly repo: Repository<Process>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly webhook: WebhookService,
    private readonly email: EmailService,
    private readonly documents: DocumentsService,
  ) {}

  async create(dto: CreateProcessDto, caller: RequestUserFull) {
    const client = await this.userRepo.findOne({
      where: { id: dto.clientId, tenantId: caller.tenantId!, role: 'cliente' },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado no tenant');

    const analistaId =
      caller.role === 'analista' ? caller.userId : (dto.analistaId ?? null);

    const process = this.repo.create({
      tenantId: caller.tenantId!,
      clientId: dto.clientId,
      analistaId,
      unidadeId: dto.unidadeId ?? null,
      valorUnidade: dto.valorUnidade ?? null,
      valorEmAberto: dto.valorEmAberto ?? null,
      stage: 'inicial',
    });

    return this.repo.save(process);
  }

  async findAll(caller: RequestUserFull, stage?: ProcessStage, empreendimentoId?: string) {
    const qb = this.repo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.client', 'client')
      .leftJoinAndSelect('p.analista', 'analista')
      .leftJoinAndSelect('p.unidade', 'unidade')
      .where('p.tenantId = :tenantId', { tenantId: caller.tenantId! })
      .andWhere('p.active = :active', { active: true })
      .orderBy('p.updatedAt', 'DESC');

    if (stage) qb.andWhere('p.stage = :stage', { stage });

    if (caller.role === 'cliente') {
      qb.andWhere('p.clientId = :clientId', { clientId: caller.userId });
    }

    if (caller.role === 'analista') {
      qb.andWhere('p.analistaId = :analistaId', { analistaId: caller.userId });
    }

    if (empreendimentoId) {
      qb.andWhere('unidade.empreendimentoId = :empId', { empId: empreendimentoId });
    }

    return qb.getMany();
  }

  async findOne(id: string, caller: RequestUserFull) {
    const qb = this.repo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.client', 'client')
      .leftJoinAndSelect('p.analista', 'analista')
      .leftJoinAndSelect('p.unidade', 'unidade')
      .leftJoinAndSelect('unidade.empreendimento', 'empreendimento')
      .where('p.id = :id', { id })
      .andWhere('p.tenantId = :tenantId', { tenantId: caller.tenantId! });

    if (caller.role === 'cliente') {
      qb.andWhere('p.clientId = :clientId', { clientId: caller.userId });
    }

    const process = await qb.getOne();
    if (!process) throw new NotFoundException('Processo não encontrado');
    return process;
  }

  async updateFields(id: string, dto: Partial<{ analistaId: string | null; unidadeId: string | null; valorUnidade: number | null; valorEmAberto: number | null; mipValue: number | null; dfiValue: number | null; fonteRenda: string | null; estadoCivil: string | null }>, caller: RequestUserFull) {
    const process = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!process) throw new NotFoundException('Processo não encontrado');

    const wasNoFonteRenda = !process.fonteRenda;
    Object.assign(process, dto);
    const saved = await this.repo.save(process);

    if (wasNoFonteRenda && dto.fonteRenda) {
      await this.documents.initChecklist(id, caller);
    }

    return saved;
  }

  async advanceStage(id: string, dto: AdvanceStageDto, caller: RequestUserFull) {
    const process = await this.repo.findOne({
      where: { id, tenantId: caller.tenantId! },
    });
    if (!process) throw new NotFoundException('Processo não encontrado');

    if (dto.toStage === 'cliente_inativo' && !dto.motivoInatividade) {
      throw new BadRequestException('Motivo de inatividade é obrigatório');
    }
    if (dto.toStage === 'credito_recusado' && !dto.motivoRecusa) {
      throw new BadRequestException('Motivo da recusa é obrigatório');
    }

    const fromStage = process.stage;

    // RN-04: gate only for forward moves starting from analise_credito onward.
    // inicial → cadastro is always allowed (no docs required yet).
    const fromIdx = LINEAR_STAGES.indexOf(fromStage);
    const gateActive = isForwardMove(fromStage, dto.toStage) &&
      fromIdx >= LINEAR_STAGES.indexOf('analise_credito');

    if (gateActive) {
      const [counts] = await this.dataSource.query<[{ total: string; pending: string }]>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status != 'validado') AS pending
         FROM documents
         WHERE process_id = $1 AND tenant_id = $2`,
        [id, caller.tenantId],
      );

      if (Number(counts.total) > 0 && Number(counts.pending) > 0) {
        const pendingDocs = await this.dataSource.query<{ label: string; status: string }[]>(
          `SELECT COALESCE(label, name) AS label, status
           FROM documents
           WHERE process_id = $1 AND tenant_id = $2 AND status != 'validado'
           ORDER BY created_at`,
          [id, caller.tenantId],
        );
        throw new UnprocessableEntityException({
          message: `${Number(counts.pending)} documento(s) pendente(s) de validação`,
          pendingDocs,
        });
      }
    }

    const updates: Partial<Process> = { stage: dto.toStage };
    if (dto.motivoInatividade) updates.motivoInatividade = dto.motivoInatividade;
    if (dto.motivoRecusa) updates.motivoRecusa = dto.motivoRecusa;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Process, id, updates);
      await manager.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, from_state, to_state)
         VALUES ($1, $2, $3, 'stage_change', $4, $5)`,
        [caller.tenantId, id, caller.userId, fromStage, dto.toStage],
      );
    });

    // Load client info so n8n and ACS email have everything needed
    const client = await this.userRepo.findOne({ where: { id: process.clientId } });
    this.webhook.fireAndForget('stage-change', {
      processId: id,
      tenantId: caller.tenantId,
      fromStage,
      toStage: dto.toStage,
      actorId: caller.userId,
      clientId: process.clientId,
      clientName: client?.name ?? null,
      clientEmail: client?.email ?? null,
      clientPhone: client?.telefone ?? null,
    });
    if (client?.email && client?.name) {
      this.email.sendStageChange(client.email, client.name, fromStage, dto.toStage);
    }

    return { id, fromStage, toStage: dto.toStage };
  }

  async deactivate(id: string, caller: RequestUserFull) {
    const process = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!process) throw new NotFoundException('Processo não encontrado');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Process, id, { active: false });
      await manager.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, from_state, to_state)
         VALUES ($1, $2, $3, 'process_deactivated', 'active', 'inactive')`,
        [caller.tenantId, id, caller.userId],
      );
    });
    return { id, active: false };
  }

  async getAuditLog(id: string, caller: RequestUserFull) {
    const process = await this.repo.findOne({
      where: { id, tenantId: caller.tenantId! },
    });
    if (!process) throw new NotFoundException('Processo não encontrado');

    return this.dataSource.query(
      `SELECT al.*, u.name as actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.process_id = $1
       ORDER BY al.created_at DESC`,
      [id],
    );
  }
}
