import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { AzureStorageService } from '../common/services/azure-storage.service';
import { MessagingService } from '../messaging/messaging.service';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { Document } from './document.entity';
import { DocumentType } from './document-type.entity';
import type { DocumentStatus } from './document.entity';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { FORM_LABELS, formsAvailable, type FormType } from './document-forms';

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

// PROD-12: one row of document_versions, as read for the history
interface VersionRow {
  id: string;
  version: number;
  created_at: Date;
  mime_type: string | null;
  size_bytes: string | null;
  status: 'recebido' | 'validado' | 'rejeitado';
  reviewed_at: Date | null;
  review_notes: string | null;
  downloadable: boolean;
  uploaded_by_name: string | null;
  reviewed_by_name: string | null;
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
    private readonly messaging: MessagingService,
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

    const docs = [...personalDocs, ...processDocs];
    if (docs.length === 0) return docs;
    // PROD-12: how many file versions each document has (the history)
    const counts = await this.dataSource.query<{ document_id: string; n: number }[]>(
      `SELECT document_id, count(*)::int AS n FROM document_versions
        WHERE tenant_id = $1 AND document_id = ANY($2::uuid[])
        GROUP BY document_id`,
      [caller.tenantId, docs.map((d) => d.id)],
    );
    const versions = new Map(counts.map((c) => [c.document_id, c.n]));
    return docs.map((d) => (versions.has(d.id) ? { ...d, versionCount: versions.get(d.id) } : d));
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
      const labels = created.map((d) => d.label ?? d.name);
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
           VALUES ($1, $2, $3, 'documents_requested', $4::jsonb)`,
          [tenantId, processId, caller.userId, JSON.stringify({ labels })],
        );
        // BE-15_v2: the client is asked for the documents (point 1 of the flow)
        await this.messaging.documentsRequested(manager, {
          tenantId,
          processId,
          clientId: process.clientId,
          labels,
        });
      });
    }

    return {
      created: created.length,
      skipped: types.length - created.length,
      documents: created,
    };
  }

  // BE-10 / LGPD: removes a document completely — the files in storage (every
  // version, with their snapshots) and the database rows — and drops the
  // original file name from earlier audit entries, since it may identify the
  // person. The removal itself is audited without personal data. If the
  // storage is unavailable, nothing is deleted; if it fails halfway, the rows
  // stay and removing again finishes the job (deleting a missing file is a no-op).
  async removeDocument(
    docId: string,
    opts: { reason?: string; processId?: string },
    caller: RequestUserFull,
  ) {
    const tenantId = caller.tenantId!;
    const doc = await this.repo.findOne({ where: { id: docId, tenantId } });
    if (!doc) throw new NotFoundException('Documento não encontrado');

    // PROD-12: the current file and every older version
    const versions = await this.dataSource.query<{ blob_path: string }[]>(
      `SELECT blob_path FROM document_versions WHERE document_id = $1 AND tenant_id = $2`,
      [docId, tenantId],
    );
    const files = [
      ...new Set([doc.blobPath, ...versions.map((v) => v.blob_path)]),
    ].filter((p): p is string => !!p && !p.startsWith('local://'));
    const hasFile = files.length > 0;
    if (hasFile) {
      if (!this.azureStorage.isAvailable) {
        throw new ServiceUnavailableException(
          'Armazenamento indisponível — o documento não foi excluído. Tente novamente.',
        );
      }
      for (const file of files) await this.azureStorage.delete(file);
    }

    // Personal docs have no process of their own: log it on the process the
    // user was looking at, if it is one of this client's.
    let auditProcessId = doc.processId;
    if (!auditProcessId && opts.processId && doc.userId) {
      const viewed = await this.processRepo.findOne({
        where: { id: opts.processId, tenantId, clientId: doc.userId },
      });
      auditProcessId = viewed?.id ?? null;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Document, { id: docId, tenantId });
      await manager.query(
        `UPDATE audit_logs SET metadata = metadata - 'fileName'
          WHERE tenant_id = $1 AND metadata->>'docId' = $2`,
        [tenantId, docId],
      );
      await manager.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
         VALUES ($1, $2, $3, 'document_deleted', $4::jsonb)`,
        [
          tenantId,
          auditProcessId,
          caller.userId,
          JSON.stringify({
            docId,
            label: doc.label ?? doc.name,
            category: doc.category,
            hadFile: hasFile,
            reason: opts.reason?.trim() || null,
          }),
        ],
      );
    });

    return { id: docId, deleted: true, fileRemoved: hasFile };
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
      }
    }

    // PROD-12: validating or rejecting applies to the current file version,
    // recorded together with the document
    const reviewed = isAnalista && (dto.status === 'validado' || dto.status === 'rejeitado');
    const saved = reviewed
      ? await this.dataSource.transaction(async (manager) => {
          await manager.update(Document, { id: docId, tenantId: caller.tenantId! }, {
            status: doc.status,
            notes: doc.notes,
            validated: doc.validated,
            validatedBy: doc.validatedBy,
            validatedAt: doc.validatedAt,
            validatedByNotes: doc.validatedByNotes,
          });
          await manager.query(
            `UPDATE document_versions
                SET status = $1, reviewed_by = $2, reviewed_at = now(), review_notes = $3
              WHERE id = (SELECT id FROM document_versions
                           WHERE document_id = $4 AND tenant_id = $5
                           ORDER BY version DESC LIMIT 1)`,
            [dto.status, caller.userId, dto.validatedByNotes ?? dto.notes ?? null, docId, caller.tenantId],
          );
          return doc;
        })
      : await this.repo.save(doc);

    // The client is told which document to send again, and why.
    if (isAnalista && dto.status === 'rejeitado' && doc.userId) {
      const clientId = doc.userId;
      await this.dataSource.transaction((manager) =>
        this.messaging.documentRejected(manager, {
          tenantId: caller.tenantId!,
          processId: doc.processId,
          clientId,
          label: doc.label ?? doc.name,
          notes: dto.notes ?? doc.notes,
        }),
      );
    }

    // FE-22: validation and rejection show up in the process activity timeline
    // (RN-07). Personal docs have no process of their own, so they are skipped.
    if (
      isAnalista &&
      doc.processId &&
      (dto.status === 'validado' || dto.status === 'rejeitado')
    ) {
      await this.dataSource.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          caller.tenantId,
          doc.processId,
          caller.userId,
          dto.status === 'validado'
            ? 'document_validated'
            : 'document_rejected',
          JSON.stringify({ docId, label: doc.label ?? doc.name }),
        ],
      );
    }

    return saved;
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
    // Personal docs (processId = null) use client path; process docs use process
    // path. PROD-12: every upload is a new version with a file of its own, so
    // sending again never overwrites (or orphans) the previous one.
    const folder = doc.processId
      ? `${caller.tenantId}/${doc.processId}/${docId}`
      : `${caller.tenantId}/clients/${doc.userId ?? 'unknown'}/${docId}`;
    const blobName = `${folder}/${randomUUID()}.${ext}`;

    const stored = this.azureStorage.isAvailable;
    const blobPath = stored
      ? await this.azureStorage.upload(blobName, file.buffer, file.mimetype)
      : `local://${blobName}`;
    const sizeBytes = file.size ?? file.buffer.length;

    try {
      return await this.dataSource.transaction(async (manager) => {
        // Locks the document: simultaneous uploads get consecutive versions.
        await manager.query(`SELECT id FROM documents WHERE id = $1 FOR UPDATE`, [docId]);
        const [{ version }] = await manager.query<{ version: number }[]>(
          `INSERT INTO document_versions
             (tenant_id, document_id, version, blob_path, mime_type, size_bytes, uploaded_by)
           SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4, $5, $6
             FROM document_versions WHERE document_id = $2
           RETURNING version`,
          [caller.tenantId, docId, blobPath, file.mimetype, sizeBytes, caller.userId],
        );

        // The document now points to the new version and waits for validation
        // again — even after a rejection or a validation: the RN-04 gate looks
        // only at the current version. The older ones stay in the history.
        const current = {
          blobPath,
          mimeType: file.mimetype,
          sizeBytes,
          uploadedBy: caller.userId,
          status: 'recebido' as DocumentStatus,
          validated: false,
          validatedBy: null,
          validatedAt: null,
          validatedByNotes: null,
        };
        await manager.update(Document, { id: docId, tenantId: caller.tenantId! }, current);

        if (doc.processId) {
          await manager.query(
            `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
             VALUES ($1, $2, $3, 'document_upload', $4::jsonb)`,
            [caller.tenantId, doc.processId, caller.userId, JSON.stringify({ docId, label: doc.label, fileName: file.originalname, version })],
          );
        }
        return Object.assign(doc, current);
      });
    } catch (err) {
      // no file is left behind without its version
      if (stored) await this.azureStorage.delete(blobPath).catch(() => false);
      throw err;
    }
  }

  // PROD-12: the file history of a document, newest first — same access as
  // downloading it (the team of the assessoria, or the client who owns it).
  async listVersions(docId: string, caller: RequestUserFull) {
    await this.findReadable(docId, caller);
    const rows = await this.dataSource.query<VersionRow[]>(
      `SELECT v.id, v.version, v.created_at, v.mime_type, v.size_bytes, v.status,
              v.reviewed_at, v.review_notes, v.blob_path NOT LIKE 'local://%' AS downloadable,
              NULLIF(concat_ws(' ', u.name, u.surname), '') AS uploaded_by_name,
              NULLIF(concat_ws(' ', r.name, r.surname), '') AS reviewed_by_name
         FROM document_versions v
         LEFT JOIN users u ON u.id = v.uploaded_by
         LEFT JOIN users r ON r.id = v.reviewed_by
        WHERE v.document_id = $1 AND v.tenant_id = $2
        ORDER BY v.version DESC`,
      [docId, caller.tenantId],
    );
    return rows.map((r, i) => ({
      id: r.id,
      version: r.version,
      current: i === 0,
      createdAt: r.created_at,
      uploadedByName: r.uploaded_by_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
      status: r.status,
      reviewedByName: r.reviewed_by_name,
      reviewedAt: r.reviewed_at,
      reviewNotes: r.review_notes,
      downloadable: r.downloadable,
    }));
  }

  async downloadVersion(docId: string, versionId: string, caller: RequestUserFull) {
    const doc = await this.findReadable(docId, caller);
    const [v] = await this.dataSource.query<{ blob_path: string; version: number }[]>(
      `SELECT blob_path, version FROM document_versions
        WHERE id = $1 AND document_id = $2 AND tenant_id = $3`,
      [versionId, docId, caller.tenantId],
    );
    if (!v) throw new NotFoundException('Versão não encontrada');
    if (v.blob_path.startsWith('local://')) {
      throw new NotFoundException('Versão armazenada localmente — visualização não disponível');
    }
    if (!this.azureStorage.isAvailable) {
      throw new NotFoundException('Serviço de armazenamento indisponível');
    }
    const blob = await this.azureStorage.download(v.blob_path);
    return { ...blob, fileName: `${doc.label ?? doc.name} (versão ${v.version})` };
  }

  private async findReadable(docId: string, caller: RequestUserFull) {
    const doc = await this.repo.findOne({ where: { id: docId, tenantId: caller.tenantId! } });
    if (!doc) throw new NotFoundException('Documento não encontrado');
    if (caller.role === 'cliente' && doc.userId !== caller.userId) {
      throw new ForbiddenException();
    }
    return doc;
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

  // FE-23: DPS and financing filled in the app become a document of the
  // process checklist — "recebido", to be validated by the analista like any
  // other (RN-04). A validated form is not overwritten.
  async submitForm(
    processId: string,
    formType: FormType,
    data: object,
    caller: RequestUserFull,
  ) {
    const process = await this.resolveProcess(processId, caller);
    if (!formsAvailable(process.stage, process.stageBeforePendencia)) {
      throw new UnprocessableEntityException(
        'Os formulários ficam disponíveis a partir da Análise de Crédito',
      );
    }

    const label = FORM_LABELS[formType];
    let doc = await this.repo.findOne({
      where: { processId, formType, tenantId: caller.tenantId! },
    });
    if (doc?.status === 'validado') {
      throw new UnprocessableEntityException(
        'Formulário já validado pelo analista',
      );
    }
    doc ??= this.repo.create({
      tenantId: caller.tenantId!,
      processId,
      userId: process.clientId,
      name: label,
      label,
      category: 'outros',
      formType,
    });
    doc.formData = { ...data };
    doc.status = 'recebido';
    doc.validated = false;
    doc.validatedByNotes = null;
    doc.uploadedBy = caller.userId;
    const saved = await this.repo.save(doc);

    await this.dataSource.query(
      `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
       VALUES ($1, $2, $3, 'form_submitted', $4::jsonb)`,
      [
        caller.tenantId,
        processId,
        caller.userId,
        JSON.stringify({ docId: saved.id, label }),
      ],
    );
    return saved;
  }

  private async resolveProcess(processId: string, caller: RequestUserFull) {
    const where: Record<string, unknown> = { id: processId, tenantId: caller.tenantId! };
    if (caller.role === 'cliente') where['clientId'] = caller.userId;

    const process = await this.processRepo.findOne({ where });
    if (!process) throw new NotFoundException('Processo não encontrado');
    return process;
  }
}
