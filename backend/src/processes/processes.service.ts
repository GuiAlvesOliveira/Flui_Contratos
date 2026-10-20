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
import { MessagingService } from '../messaging/messaging.service';
import { User } from '../users/user.entity';
import { AdvanceStageDto } from './dto/advance-stage.dto';
import { CreateProcessDto } from './dto/create-process.dto';
import { UpdateProcessDto } from './dto/update-process.dto';
import { allowedTransitions, LINEAR_STAGES, Process, ProcessStage } from './process.entity';
import { processesCsv, type ExportRow } from './processes-csv';
import { financingSql, planRateSql, SUGGESTED_COMMISSION } from '../reports/success-fee';

// RN-04: a process may only move past analise_credito with every document
// validated. Applies to forward moves starting from analise_credito onward
// (inicial → cadastro → analise_credito need no validated docs yet) and to any
// resume from processo_pendencia into a stage beyond analise_credito, so the
// hold can't be used to route around the gate. Moves into side stages never
// trigger it.
function requiresDocGate(from: ProcessStage, to: ProcessStage): boolean {
  const gateFrom = LINEAR_STAGES.indexOf('analise_credito');
  const ti = LINEAR_STAGES.indexOf(to);
  if (from === 'processo_pendencia') return ti > gateFrom;
  const fi = LINEAR_STAGES.indexOf(from);
  return fi >= gateFrom && ti > fi;
}

// PROD-09: the assessoria's commission and the Flui fee rate are internal —
// the cliente only sees the contract date.
function hideCommission<T extends Process>(p: T): Omit<T, 'comissaoAssessoria' | 'taxaSuccessFee'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { comissaoAssessoria, taxaSuccessFee, ...rest } = p;
  return rest;
}

@Injectable()
export class ProcessesService {
  constructor(
    @InjectRepository(Process) private readonly repo: Repository<Process>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly messaging: MessagingService,
  ) {}

  async create(dto: CreateProcessDto, caller: RequestUserFull) {
    const client = await this.userRepo.findOne({
      where: { id: dto.clientId, tenantId: caller.tenantId!, role: 'cliente' },
    });
    if (!client) throw new NotFoundException('Cliente não encontrado no tenant');

    await this.assertAssociationsInTenant(
      caller.tenantId!,
      caller.role === 'analista' ? null : dto.analistaId,
      dto.unidadeId,
    );

    const analistaId =
      caller.role === 'analista' ? caller.userId : (dto.analistaId ?? null);

    const process = this.repo.create({
      tenantId: caller.tenantId!,
      clientId: dto.clientId,
      analistaId,
      unidadeId: dto.unidadeId ?? null,
      valorUnidade: dto.valorUnidade ?? null,
      valorEmAberto: dto.valorEmAberto ?? null,
      // what the client declared in the onboarding (editable in the process)
      estadoCivil: client.estadoCivil ?? null,
      fonteRenda: client.fonteRenda ?? null,
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

    const list = await qb.getMany();
    return caller.role === 'cliente' ? list.map(hideCommission) : list;
  }

  // BE-17: every active process of the tenant as CSV (gestor only). Exporting
  // personal data is recorded in the audit log (LGPD).
  async exportCsv(caller: RequestUserFull): Promise<string> {
    const rows = await this.dataSource.query<ExportRow[]>(
      `SELECT p.id, p.stage, p.created_at,
              c.name AS client_name, c.surname AS client_surname, c.email AS client_email,
              a.name AS analista_name, e.nome AS empreendimento,
              un.identificacao AS unidade, p.valor_unidade
         FROM processes p
         JOIN users c ON c.id = p.client_id
         LEFT JOIN users a ON a.id = p.analista_id
         LEFT JOIN unidades un ON un.id = p.unidade_id
         LEFT JOIN empreendimentos e ON e.id = un.empreendimento_id
        WHERE p.tenant_id = $1 AND p.active = true
        ORDER BY p.created_at DESC`,
      [caller.tenantId],
    );
    await this.dataSource.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, metadata)
       VALUES ($1, $2, 'processes_exported', $3::jsonb)`,
      [caller.tenantId, caller.userId, JSON.stringify({ count: rows.length })],
    );
    return processesCsv(rows);
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

    // RN-06: surface the server-computed income composition alongside the
    // process so the UI never has to re-sum participants client-side.
    const composition = await this.computeIncomeComposition(id, caller.tenantId!);
    const visible = caller.role === 'cliente' ? hideCommission(process) : process;
    return { ...visible, ...composition };
  }

  // RN-06: income composition = sum of every participant's declared income.
  // Validates tenant/cliente access, then returns the authoritative aggregate.
  async getIncomeComposition(id: string, caller: RequestUserFull) {
    const where: { id: string; tenantId: string; clientId?: string } = {
      id,
      tenantId: caller.tenantId!,
    };
    if (caller.role === 'cliente') where.clientId = caller.userId!;

    const process = await this.repo.findOne({ where });
    if (!process) throw new NotFoundException('Processo não encontrado');

    return this.computeIncomeComposition(id, caller.tenantId!);
  }

  // RN-06: aggregate declared income in the database (exact numeric SUM) to
  // avoid client-side float drift; rounds the final cast to cents.
  private async computeIncomeComposition(
    processId: string,
    tenantId: string,
  ): Promise<{ composedIncome: number; participantCount: number }> {
    const [row] = await this.dataSource.query<[{ total: string; count: string }]>(
      `SELECT COALESCE(SUM(declared_income), 0) AS total, COUNT(*) AS count
       FROM process_participants
       WHERE process_id = $1 AND tenant_id = $2`,
      [processId, tenantId],
    );
    return {
      composedIncome: Math.round(Number(row.total) * 100) / 100,
      participantCount: Number(row.count),
    };
  }

  async updateFields(id: string, dto: UpdateProcessDto, caller: RequestUserFull) {
    const process = await this.repo.findOne({ where: { id, tenantId: caller.tenantId! } });
    if (!process) throw new NotFoundException('Processo não encontrado');

    await this.assertAssociationsInTenant(caller.tenantId!, dto.analistaId, dto.unidadeId);

    // PROD-09: a comissão entra no success fee — a troca fica no Log de Ações
    const before = process.comissaoAssessoria == null ? null : Number(process.comissaoAssessoria);
    const after = dto.comissaoAssessoria === undefined ? before : dto.comissaoAssessoria;

    // BE-03: setting the income source no longer creates a fixed checklist;
    // the analista requests the documents from the assessoria's catalog.
    Object.assign(process, dto);
    if (after === before) return this.repo.save(process);
    // the new value and its audit entry are saved together (RN-07)
    return this.dataSource.transaction(async (manager) => {
      const saved = await manager.save(process);
      await manager.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
         VALUES ($1, $2, $3, 'commission_updated', $4::jsonb)`,
        [caller.tenantId, id, caller.userId, JSON.stringify({ before, after })],
      );
      return saved;
    });
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

    // BR-01: only allow transitions declared in the state machine.
    if (fromStage === dto.toStage) {
      throw new BadRequestException('O processo já está nesta etapa');
    }
    if (!allowedTransitions(fromStage, process.stageBeforePendencia).includes(dto.toStage)) {
      throw new UnprocessableEntityException(
        fromStage === 'processo_pendencia' && process.stageBeforePendencia
          ? `Processo em pendência só pode ser retomado até a etapa "${process.stageBeforePendencia}"`
          : `Transição inválida de "${fromStage}" para "${dto.toStage}"`,
      );
    }

    // BR-02 (RN-05): MIP and DFI are mandatory before the contract/registry phase.
    if (
      (dto.toStage === 'cartorio' || dto.toStage === 'assinatura') &&
      (process.mipValue == null || process.dfiValue == null)
    ) {
      throw new UnprocessableEntityException(
        'Informe os valores de MIP e DFI antes de avançar para cartório/assinatura (RN-05)',
      );
    }

    if (requiresDocGate(fromStage, dto.toStage)) {
      // The gate covers the process's income docs AND the client's personal
      // docs, which are stored once per client (process_id NULL) and shared by
      // all their processes. `total` counts only the process's own checklist.
      const [counts] = await this.dataSource.query<[{ total: string; pending: string }]>(
        `SELECT COUNT(*) FILTER (WHERE process_id = $1) AS total,
                COUNT(*) FILTER (WHERE status != 'validado') AS pending
         FROM documents
         WHERE tenant_id = $2
           AND (process_id = $1 OR (process_id IS NULL AND user_id = $3))`,
        [id, caller.tenantId, process.clientId],
      );

      // RN-04 fail-closed: a process with no document of its own requested
      // (total = 0) is blocked instead of let through.
      if (Number(counts.total) === 0) {
        throw new UnprocessableEntityException(
          'Nenhum documento solicitado para este processo — solicite os documentos antes de avançar (RN-04)',
        );
      }
      if (Number(counts.pending) > 0) {
        const pendingDocs = await this.dataSource.query<{ label: string; status: string }[]>(
          `SELECT COALESCE(label, name) AS label, status
           FROM documents
           WHERE tenant_id = $2
             AND (process_id = $1 OR (process_id IS NULL AND user_id = $3))
             AND status != 'validado'
           ORDER BY created_at`,
          [id, caller.tenantId, process.clientId],
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
    if (dto.toStage === 'processo_pendencia') updates.stageBeforePendencia = fromStage;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Process, id, updates);
      if (dto.toStage === 'assinatura') {
        // PROD-09: contrato assinado agora, com a taxa do plano congelada e,
        // se a comissão ainda não foi informada, a sugestão de 2% do financiamento
        await manager.query(
          `UPDATE processes p
              SET contrato_assinado_em = now(),
                  taxa_success_fee = ${planRateSql('t.plano')},
                  comissao_assessoria = COALESCE(
                    p.comissao_assessoria,
                    ROUND(${financingSql('p')} * ${SUGGESTED_COMMISSION}, 2))
             FROM tenants t
            WHERE t.id = p.tenant_id AND p.id = $1 AND p.tenant_id = $2`,
          [id, caller.tenantId],
        );
      }
      await manager.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, from_state, to_state)
         VALUES ($1, $2, $3, 'stage_change', $4, $5)`,
        [caller.tenantId, id, caller.userId, fromStage, dto.toStage],
      );
      // RN-08_v2: the client (and, on a pendência, the analista) is notified
      // through the outbox, in the same transaction as the move.
      await this.messaging.stageChanged(manager, {
        tenantId: caller.tenantId!,
        processId: id,
        clientId: process.clientId,
        analistaId: process.analistaId,
        fromStage,
        toStage: dto.toStage,
      });
    });

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

  // RN-01: same visibility as findOne — a cliente only reads their own process.
  async getAuditLog(id: string, caller: RequestUserFull) {
    const where: { id: string; tenantId: string; clientId?: string } = {
      id,
      tenantId: caller.tenantId!,
    };
    if (caller.role === 'cliente') where.clientId = caller.userId;

    const process = await this.repo.findOne({ where });
    if (!process) throw new NotFoundException('Processo não encontrado');

    // Edits and removals in the Histórico de Atividades are internal to the
    // assessoria (they carry the previous text and the removal reason), and so
    // is the commission (PROD-09).
    const internal =
      caller.role === 'cliente'
        ? `AND al.action NOT IN ('activity_edited', 'activity_deleted', 'commission_updated')`
        : '';
    return this.dataSource.query(
      `SELECT al.*, u.name as actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE al.process_id = $1 AND al.tenant_id = $2 ${internal}
       ORDER BY al.created_at DESC`,
      [id, caller.tenantId],
    );
  }

  // Ensures analista/unidade referenced by a process belong to the caller's
  // tenant (and that analista has the right role) before they are linked — a
  // `dono` must not attach another tenant's analista/unidade (SEC-08, RN-01).
  private async assertAssociationsInTenant(
    tenantId: string,
    analistaId?: string | null,
    unidadeId?: string | null,
  ): Promise<void> {
    if (analistaId) {
      const analista = await this.userRepo.findOne({
        where: { id: analistaId, tenantId, role: 'analista' },
      });
      if (!analista) throw new NotFoundException('Analista não encontrado no tenant');
    }
    if (unidadeId) {
      const [unidade] = await this.dataSource.query<{ id: string }[]>(
        `SELECT id FROM unidades WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [unidadeId, tenantId],
      );
      if (!unidade) throw new NotFoundException('Unidade não encontrada no tenant');
    }
  }
}
