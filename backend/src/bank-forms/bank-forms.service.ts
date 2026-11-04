import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { RequestUserFull } from '../auth/supabase.guard';
import { AzureStorageService } from '../common/services/azure-storage.service';
import { FichaService } from '../ficha/ficha.service';
import { fillPdf } from './pdf-fill';
import { BANK_FORM_BY_KEY, BANK_FORMS, BankFormTemplate } from './templates';

interface FileRow {
  id: string;
  form_key: string;
  template_version: string;
  blob_path: string;
  filled_fields: number;
  total_fields: number;
  created_at: Date;
  generated_by_name: string | null;
}

// Formulários do banco preenchidos com a ficha e salvos no processo. Só a
// equipe gera, lista e baixa: o cliente não vê esses arquivos.
@Injectable()
export class BankFormsService {
  private readonly logger = new Logger(BankFormsService.name);
  private readonly cache = new Map<string, Buffer>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly ficha: FichaService,
    private readonly storage: AzureStorageService,
  ) {}

  /** modelo: pasta local (dev/testes) ou `_templates/` no Blob privado */
  async loadTemplate(t: BankFormTemplate): Promise<Buffer | null> {
    const hit = this.cache.get(t.key);
    if (hit) return hit;
    let buf: Buffer | null = null;
    const dir = process.env.BANK_FORM_TEMPLATES_DIR;
    if (dir) buf = await fs.readFile(join(dir, t.file)).catch(() => null);
    if (!buf && this.storage.isAvailable) {
      try {
        const blob = await this.storage.download(`_templates/${t.file}`);
        const chunks: Buffer[] = [];
        for await (const c of blob.stream)
          chunks.push(Buffer.from(c as Buffer));
        buf = Buffer.concat(chunks);
      } catch (err) {
        this.logger.warn(
          `Modelo ${t.file} indisponível: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (buf) this.cache.set(t.key, buf);
    return buf;
  }

  async list(processId: string, caller: RequestUserFull) {
    const snap = await this.ficha.snapshot(processId, caller);
    const forms = await Promise.all(
      BANK_FORMS.map(async (t) => {
        const built = t.build(snap);
        return {
          key: t.key,
          bank: t.bank,
          label: t.label,
          version: t.version,
          filled: built.filled,
          total: built.total,
          missing: built.missing,
          available: (await this.loadTemplate(t)) !== null,
        };
      }),
    );
    const rows = await this.dataSource.query<FileRow[]>(
      `SELECT f.id, f.form_key, f.template_version, f.blob_path, f.filled_fields, f.total_fields,
              f.created_at, u.name AS generated_by_name
         FROM bank_form_files f LEFT JOIN users u ON u.id = f.generated_by
        WHERE f.tenant_id = $1 AND f.process_id = $2
        ORDER BY f.created_at DESC LIMIT 50`,
      [caller.tenantId, processId],
    );
    return { forms, files: rows.map(toFile) };
  }

  async generate(processId: string, key: string, caller: RequestUserFull) {
    const t = BANK_FORM_BY_KEY.get(key);
    if (!t) throw new NotFoundException('Formulário não encontrado');
    const snap = await this.ficha.snapshot(processId, caller);
    const template = await this.loadTemplate(t);
    if (!template)
      throw new ServiceUnavailableException(
        'Modelo do formulário indisponível no servidor',
      );
    if (!this.storage.isAvailable)
      throw new ServiceUnavailableException(
        'Serviço de armazenamento indisponível',
      );

    const built = t.build(snap);
    let pdf: Buffer;
    try {
      pdf = await fillPdf(template, built.fields);
    } catch (err) {
      this.logger.error(
        `Falha ao preencher ${t.key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException(
        'Não foi possível preencher o formulário do banco',
      );
    }

    const id = randomUUID();
    const { tenantId, id: procId } = snap.process;
    const blobPath = `${tenantId}/${procId}/bank-forms/${id}.pdf`;
    await this.storage.upload(blobPath, pdf, 'application/pdf');
    try {
      await this.dataSource.transaction(async (m) => {
        await m.query(
          `INSERT INTO bank_form_files
             (id, tenant_id, process_id, form_key, template_version, blob_path, size_bytes,
              filled_fields, total_fields, generated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            id,
            tenantId,
            procId,
            t.key,
            t.version,
            blobPath,
            pdf.length,
            built.filled,
            built.total,
            caller.userId,
          ],
        );
        await m.query(
          `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
           VALUES ($1, $2, $3, 'bank_form_generated', $4::jsonb)`,
          [
            tenantId,
            procId,
            caller.userId,
            JSON.stringify({
              fileId: id,
              formKey: t.key,
              version: t.version,
              label: `${t.bank} — ${t.label}`,
            }),
          ],
        );
      });
    } catch (err) {
      await this.storage.delete(blobPath).catch(() => false);
      throw err;
    }
    return {
      id,
      formKey: t.key,
      label: t.label,
      bank: t.bank,
      version: t.version,
      filledFields: built.filled,
      totalFields: built.total,
      createdAt: new Date(),
      generatedBy: null,
    };
  }

  private async findFile(
    processId: string,
    fileId: string,
    caller: RequestUserFull,
  ) {
    // valida o acesso ao processo (RN-01) antes de olhar o arquivo
    const snap = await this.ficha.snapshot(processId, caller);
    const [row] = await this.dataSource.query<FileRow[]>(
      `SELECT f.*, NULL AS generated_by_name FROM bank_form_files f
        WHERE f.id = $1 AND f.process_id = $2 AND f.tenant_id = $3`,
      [fileId, processId, caller.tenantId],
    );
    if (!row) throw new NotFoundException('Arquivo não encontrado');
    return { row, snap };
  }

  async download(processId: string, fileId: string, caller: RequestUserFull) {
    const { row, snap } = await this.findFile(processId, fileId, caller);
    if (!this.storage.isAvailable)
      throw new NotFoundException('Serviço de armazenamento indisponível');
    const t = BANK_FORM_BY_KEY.get(row.form_key);
    const blob = await this.storage.download(row.blob_path);
    const who = snap.cliente.nome ?? 'cliente';
    return {
      ...blob,
      fileName: `${t?.bank ?? 'Banco'} - ${t?.label ?? row.form_key} - ${who}.pdf`,
    };
  }

  async remove(processId: string, fileId: string, caller: RequestUserFull) {
    const { row, snap } = await this.findFile(processId, fileId, caller);
    await this.dataSource.transaction(async (m) => {
      await m.query(`DELETE FROM bank_form_files WHERE id = $1`, [row.id]);
      await m.query(
        `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata)
         VALUES ($1, $2, $3, 'bank_form_deleted', $4::jsonb)`,
        [
          snap.process.tenantId,
          snap.process.id,
          caller.userId,
          JSON.stringify({ fileId: row.id, formKey: row.form_key }),
        ],
      );
    });
    if (this.storage.isAvailable)
      await this.storage.delete(row.blob_path).catch(() => false);
    return { id: row.id, deleted: true };
  }
}

function toFile(r: FileRow) {
  const t = BANK_FORM_BY_KEY.get(r.form_key);
  return {
    id: r.id,
    formKey: r.form_key,
    label: t?.label ?? r.form_key,
    bank: t?.bank ?? null,
    version: r.template_version,
    filledFields: r.filled_fields,
    totalFields: r.total_fields,
    createdAt: r.created_at,
    generatedBy: r.generated_by_name,
  };
}
