import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { AzureStorageService } from '../common/services/azure-storage.service';
import { EmailService } from '../email/email.service';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { Document } from './document.entity';
import type { DocumentStatus } from './document.entity';
import { UpdateDocumentDto } from './dto/update-document.dto';

// ── Checklist templates ───────────────────────────────────────────────────────

// Personal docs are stored once per client (processId = null) and shared across all their processes
const DOCS_PESSOAL = [
  { docType: 'rg_cnh', label: 'RG ou CNH' },
  { docType: 'comprovante_endereco', label: 'Comprovante de Endereço' },
  { docType: 'cert_estado_civil', label: 'Certidão de Estado Civil' },
];

const DOCS_ASSALARIADO = [
  { docType: 'holerite_1', label: 'Holerite (mês 1)' },
  { docType: 'holerite_2', label: 'Holerite (mês 2)' },
  { docType: 'holerite_3', label: 'Holerite (mês 3)' },
  { docType: 'irpf', label: 'Declaração de IRPF' },
];

const DOCS_NAO_ASSALARIADO = [
  { docType: 'extrato_1', label: 'Extrato Bancário (mês 1)' },
  { docType: 'extrato_2', label: 'Extrato Bancário (mês 2)' },
  { docType: 'extrato_3', label: 'Extrato Bancário (mês 3)' },
  { docType: 'extrato_4', label: 'Extrato Bancário (mês 4)' },
  { docType: 'extrato_5', label: 'Extrato Bancário (mês 5)' },
  { docType: 'extrato_6', label: 'Extrato Bancário (mês 6)' },
  { docType: 'irpf', label: 'Declaração de IRPF' },
];

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private readonly repo: Repository<Document>,
    @InjectRepository(Process) private readonly processRepo: Repository<Process>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly azureStorage: AzureStorageService,
    private readonly dataSource: DataSource,
    private readonly email: EmailService,
  ) {}

  async getForProcess(processId: string, caller: RequestUserFull) {
    const process = await this.resolveProcess(processId, caller);

    // Process-specific docs (income docs)
    const processDocs = await this.repo.find({
      where: { processId, tenantId: caller.tenantId! },
      order: { createdAt: 'ASC' },
    });

    // Client-level personal docs (shared across all client's processes)
    const personalDocs = await this.repo.find({
      where: { processId: IsNull(), userId: process.clientId, tenantId: caller.tenantId! },
      order: { createdAt: 'ASC' },
    });

    return [...personalDocs, ...processDocs];
  }

  async initChecklist(processId: string, caller: RequestUserFull) {
    const process = await this.resolveProcess(processId, caller);

    const rendaDocs =
      process.fonteRenda === 'assalariado' ? DOCS_ASSALARIADO : DOCS_NAO_ASSALARIADO;

    // ── Personal docs: create once per client, shared across all their processes ──

    const existingPersonal = await this.repo.find({
      where: { processId: IsNull(), userId: process.clientId, tenantId: caller.tenantId! },
      select: ['docType'],
    });
    const existingPersonalTypes = new Set(existingPersonal.map(d => d.docType));

    const personalToCreate = DOCS_PESSOAL.filter(t => !existingPersonalTypes.has(t.docType));
    if (personalToCreate.length > 0) {
      const personalDocs = personalToCreate.map(t =>
        this.repo.create({
          tenantId: caller.tenantId!,
          processId: null,
          userId: process.clientId,
          name: t.label,
          category: 'pessoal',
          docType: t.docType,
          label: t.label,
          status: 'pendente' as DocumentStatus,
        }),
      );
      await this.repo.save(personalDocs);
    }

    // ── Income docs: per-process ──────────────────────────────────────────────

    const existingProcess = await this.repo.find({
      where: { processId, tenantId: caller.tenantId! },
      select: ['docType'],
    });
    const existingProcessTypes = new Set(existingProcess.map(d => d.docType));

    const rendaToCreate = rendaDocs.filter(t => !existingProcessTypes.has(t.docType));
    if (rendaToCreate.length > 0) {
      const rendaDocEntities = rendaToCreate.map(t =>
        this.repo.create({
          tenantId: caller.tenantId!,
          processId,
          userId: process.clientId,
          name: t.label,
          category: 'renda',
          docType: t.docType,
          label: t.label,
          status: 'pendente' as DocumentStatus,
        }),
      );
      await this.repo.save(rendaDocEntities);
    }

    const created = personalToCreate.length + rendaToCreate.length;
    return created === 0 ? { created: 0, message: 'Checklist já inicializado' } : { created };
  }

  async update(docId: string, dto: UpdateDocumentDto, caller: RequestUserFull) {
    const doc = await this.repo.findOne({
      where: { id: docId, tenantId: caller.tenantId! },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado');

    const isAnalista = caller.role === 'analista' || caller.role === 'dono';
    const isCliente = caller.role === 'cliente';

    if (isCliente) {
      if (doc.userId !== caller.userId) throw new ForbiddenException();
      if (dto.status && !['recebido'].includes(dto.status)) {
        throw new ForbiddenException('Cliente só pode marcar como recebido');
      }
    }

    if (dto.status) doc.status = dto.status as DocumentStatus;
    if (dto.notes !== undefined) doc.notes = dto.notes;

    if (isAnalista) {
      if (dto.validatedByNotes !== undefined) doc.validatedByNotes = dto.validatedByNotes;
      if (dto.status === 'validado') {
        doc.validated = true;
        doc.validatedBy = caller.userId;
        doc.validatedAt = new Date();
      }
      if (dto.status === 'rejeitado') {
        doc.validated = false;
        if (doc.userId) {
          this.userRepo.findOne({ where: { id: doc.userId } }).then(client => {
            if (client) {
              this.email.sendDocumentRejected(
                client.email,
                client.name ?? client.email,
                doc.label ?? doc.name,
                dto.notes ?? doc.notes,
              );
            }
          }).catch(() => {/* email failure must not block the response */});
        }
      }
    }

    return this.repo.save(doc);
  }

  async uploadFile(docId: string, file: Express.Multer.File, caller: RequestUserFull) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');

    const doc = await this.repo.findOne({ where: { id: docId, tenantId: caller.tenantId! } });
    if (!doc) throw new NotFoundException('Documento não encontrado');

    if (caller.role === 'cliente' && doc.userId !== caller.userId) {
      throw new ForbiddenException();
    }

    const ext = file.originalname.split('.').pop() ?? 'bin';
    // Personal docs (processId = null) use client path; process docs use process path
    const blobName = doc.processId
      ? `${caller.tenantId}/${doc.processId}/${docId}.${ext}`
      : `${caller.tenantId}/clients/${doc.userId ?? 'unknown'}/${docId}.${ext}`;

    let blobPath: string;
    if (this.azureStorage.isAvailable) {
      blobPath = await this.azureStorage.upload(blobName, file.buffer, file.mimetype);
    } else {
      blobPath = `local://${blobName}`;
    }

    doc.blobPath = blobPath;
    doc.uploadedBy = caller.userId;
    doc.status = 'recebido' as DocumentStatus;
    const saved = await this.repo.save(doc);

    if (doc.processId) {
      const process = await this.processRepo.findOne({ where: { id: doc.processId } });
      if (process) {
        await this.dataSource.query(
          `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
           VALUES ($1, $2, $3, 'document_upload', $4::jsonb)`,
          [caller.tenantId, doc.processId, caller.userId, JSON.stringify({ docId, label: doc.label, fileName: file.originalname })],
        );
      }
    }

    return saved;
  }

  async downloadFile(docId: string, caller: RequestUserFull) {
    const doc = await this.repo.findOne({ where: { id: docId, tenantId: caller.tenantId! } });
    if (!doc) throw new NotFoundException('Documento não encontrado');

    if (caller.role === 'cliente' && doc.userId !== caller.userId) {
      throw new ForbiddenException();
    }

    if (!doc.blobPath) {
      throw new NotFoundException('Nenhum arquivo enviado para este documento');
    }

    if (doc.blobPath.startsWith('local://')) {
      throw new NotFoundException('Documento armazenado localmente — visualização não disponível');
    }

    if (!this.azureStorage.isAvailable) {
      throw new NotFoundException('Serviço de armazenamento indisponível');
    }

    const blob = await this.azureStorage.download(doc.blobPath);
    return { ...blob, fileName: doc.label ?? doc.name };
  }

  async getStats(caller: RequestUserFull) {
    if (caller.role === 'analista') {
      const [row] = await this.dataSource.query<{ pending: string; total: string }[]>(
        `SELECT
           COUNT(*) FILTER (WHERE d.status = 'recebido') AS pending,
           COUNT(*) AS total
         FROM documents d
         INNER JOIN processes p ON p.id = d.process_id
         WHERE d.tenant_id = $1 AND p.analista_id = $2 AND p.active = true`,
        [caller.tenantId, caller.userId],
      );
      return { pending: Number(row.pending), total: Number(row.total) };
    }

    const [row] = await this.dataSource.query<{ pending: string; total: string }[]>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'recebido') AS pending,
         COUNT(*) AS total
       FROM documents WHERE tenant_id = $1`,
      [caller.tenantId],
    );
    return { pending: Number(row.pending), total: Number(row.total) };
  }

  private async resolveProcess(processId: string, caller: RequestUserFull) {
    const where: Record<string, unknown> = { id: processId, tenantId: caller.tenantId! };
    if (caller.role === 'cliente') where['clientId'] = caller.userId;

    const process = await this.processRepo.findOne({ where });
    if (!process) throw new NotFoundException('Processo não encontrado');
    return process;
  }
}
