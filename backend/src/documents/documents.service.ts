import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { AzureStorageService } from '../common/services/azure-storage.service';
import { EmailService } from '../email/email.service';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { Document } from './document.entity';
import { DocumentType } from './document-type.entity';
import type { DocumentStatus } from './document.entity';
import { UpdateDocumentDto } from './dto/update-document.dto';

// ── Upload content validation (magic numbers) ─────────────────────────────────

// Validates the real bytes of an upload instead of trusting the client-declared
// Content-Type. A file disguised as image/png but containing HTML/script is
// rejected here (SEC-06). Only PDF/JPEG/PNG are accepted (see fileFilter).
function isAllowedFileContent(buffer: Buffer | undefined): boolean {
  if (!buffer || buffer.length < 4) return false;
  const isPdf =
    buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return isPdf || isPng || isJpeg;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private readonly repo: Repository<Document>,
    @InjectRepository(DocumentType) private readonly typeRepo: Repository<DocumentType>,
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

  // BE-03: the analista picks, from the assessoria's catalog, which documents
  // the client must send. Only active entries of the caller's tenant are
  // accepted (no free text). Personal docs live once per client
  // (process_id NULL) and serve all their processes; the rest belong to the
  // process. A type already requested is skipped, so repeating is harmless.
  async requestDocuments(processId: string, typeIds: string[], caller: RequestUserFull) {
    const tenantId = caller.tenantId!;
    const process = await this.resolveProcess(processId, caller);

    const types = await this.typeRepo.find({
      where: { id: In(typeIds), tenantId, active: true },
    });
    if (types.length !== new Set(typeIds).size) {
      throw new BadRequestException(
        'Só é possível solicitar documentos ativos da lista da assessoria',
      );
    }

    const existing = await this.repo.find({
      where: [
        { processId, tenantId },
        { processId: IsNull(), userId: process.clientId, tenantId },
      ],
    });
    const alreadyRequested = (t: DocumentType) =>
      existing.some(
        (d) =>
          d.documentTypeId === t.id ||
          // rows created before the catalog existed carry only the label
          (!d.documentTypeId &&
            (d.label ?? d.name).toLowerCase() === t.label.toLowerCase()),
      );

    const toCreate = types.filter((t) => !alreadyRequested(t));
    const created = await this.repo.save(
      toCreate.map((t) =>
        this.repo.create({
          tenantId,
          processId: t.category === 'pessoal' ? null : processId,
          userId: process.clientId,
          name: t.label,
          label: t.label,
          category: t.category,
          documentTypeId: t.id,
          status: 'pendente' as DocumentStatus,
        }),
      ),
    );

    if (created.length > 0) {
      await this.dataSource.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
         VALUES ($1, $2, $3, 'documents_requested', $4::jsonb)`,
        [
          tenantId,
          processId,
          caller.userId,
          JSON.stringify({ labels: created.map((d) => d.label) }),
        ],
      );
    }

    return {
      created: created.length,
      skipped: types.length - created.length,
      documents: created,
    };
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
    if (!isAllowedFileContent(file.buffer)) {
      throw new BadRequestException('Arquivo inválido: conteúdo não é um PDF, JPEG ou PNG válido');
    }

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
