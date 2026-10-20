import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RequestUserFull } from '../src/auth/supabase.guard';
import { Document } from '../src/documents/document.entity';
import { DocumentType } from '../src/documents/document-type.entity';
import { DocumentsService } from '../src/documents/documents.service';
import { MessagingService } from '../src/messaging/messaging.service';
import { Process } from '../src/processes/process.entity';
import { ProcessesService } from '../src/processes/processes.service';
import { User } from '../src/users/user.entity';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
} from './support/test-db';

// PROD-12 com PostgreSQL de verdade: serviços reais, migrations do projeto e um
// armazenamento em memória no lugar do Azure Blob (o Azurite entra no teste de
// integração com a API compilada).
const who = (tenantId: string, userId: string, role: string) =>
  ({ tenantId, userId, role }) as RequestUserFull;
const gestorA = who(IDS.tenantA, IDS.gestorA, 'dono');
const ana = who(IDS.tenantA, IDS.anaA, 'analista');
const clienteA = who(IDS.tenantA, IDS.clienteA, 'cliente');
const gestorB = who(IDS.tenantB, IDS.gestorB, 'dono');
const OUTRO_CLIENTE = 'a2000000-0000-4000-8000-000000000009';
const CLIENTE_RN04 = 'a2000000-0000-4000-8000-000000000010';

class MemoryStorage {
  isAvailable = true;
  files = new Map<string, Buffer>();
  upload(name: string, buffer: Buffer) {
    this.files.set(name, buffer);
    return Promise.resolve(name);
  }
  download(name: string) {
    const b = this.files.get(name);
    if (!b) return Promise.reject(new Error(`blob inexistente: ${name}`));
    return Promise.resolve({
      stream: Readable.from(b),
      contentType: 'application/pdf',
      contentLength: b.length,
    });
  }
  delete(name: string) {
    return Promise.resolve(this.files.delete(name));
  }
}

const pdf = (text: string) => {
  const buffer = Buffer.from(`%PDF-1.4 ${text}`);
  return {
    buffer,
    originalname: `${text}.pdf`,
    mimetype: 'application/pdf',
    size: buffer.length,
  } as Express.Multer.File;
};
const read = async (s: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString();
};

describeDb('Versões de documentos com banco real (e2e, PROD-12)', () => {
  let db: TestDb;
  let storage: MemoryStorage;
  let docs: DocumentsService;
  let processes: ProcessesService;
  const ds = () => db.dataSource;
  const config = {
    get: (k: string) =>
      k === 'FRONTEND_URL' ? 'https://app.exemplo.dev' : undefined,
  } as unknown as ConfigService;

  const newDoc = async (
    processId: string | null,
    userId: string,
    label = 'Holerite',
  ) => {
    const id = randomUUID();
    await ds().query(
      `INSERT INTO documents (id, tenant_id, process_id, user_id, name, label, category, status)
       VALUES ($1, $2, $3, $4, $5, $5, $6, 'pendente')`,
      [
        id,
        IDS.tenantA,
        processId,
        userId,
        label,
        processId ? 'renda' : 'pessoal',
      ],
    );
    return id;
  };
  const docRow = async (id: string) =>
    (
      await ds().query<
        {
          status: string;
          blob_path: string | null;
          validated: boolean;
          validated_by_notes: string | null;
        }[]
      >(
        `SELECT status, blob_path, validated, validated_by_notes FROM documents WHERE id = $1`,
        [id],
      )
    )[0];
  const versionRows = (id: string) =>
    ds().query<
      {
        version: number;
        status: string;
        blob_path: string;
        review_notes: string | null;
        reviewed_by: string | null;
        uploaded_by: string;
      }[]
    >(
      `SELECT version, status, blob_path, review_notes, reviewed_by, uploaded_by
         FROM document_versions WHERE document_id = $1 ORDER BY version`,
      [id],
    );

  beforeAll(async () => {
    db = await createTestDb('docversions');
    await seedTwoTenants(ds());
    for (const [id, name] of [
      [OUTRO_CLIENTE, 'Otávio Outro'],
      [CLIENTE_RN04, 'Rita Rn04'],
    ]) {
      await ds().query(
        `INSERT INTO users (id, tenant_id, role, name, email, status, onboarding_completed)
         VALUES ($1, $2, 'cliente', $3, $4, 'active', true)`,
        [id, IDS.tenantA, name, `${id}@e2e.exemplo.dev`],
      );
    }
    storage = new MemoryStorage();
    const messaging = new MessagingService(config, {
      soon: jest.fn(),
    } as never);
    docs = new DocumentsService(
      ds().getRepository(Document),
      ds().getRepository(DocumentType),
      ds().getRepository(Process),
      ds().getRepository(User),
      storage as never,
      ds(),
      messaging,
    );
    processes = new ProcessesService(
      ds().getRepository(Process),
      ds().getRepository(User),
      ds(),
      messaging,
    );
  }, 60_000);
  afterAll(async () => {
    await db?.drop();
  });

  it('migration: documentos que já tinham arquivo ganham a versão 1, com a data do envio e o resultado', async () => {
    await ds().undoLastMigration();
    const id = randomUUID();
    await ds().query(
      `INSERT INTO documents (id, tenant_id, process_id, user_id, name, label, status, validated,
                              validated_by, validated_at, blob_path, uploaded_by)
       VALUES ($1, $2, $3, $4, 'RG', 'RG', 'validado', true, $5, now(), 'a/b/antigo.pdf', $4)`,
      [id, IDS.tenantA, IDS.processoAna, IDS.clienteA, IDS.anaA],
    );
    await ds().query(
      `INSERT INTO audit_logs (tenant_id, process_id, actor_id, action, metadata, created_at)
       VALUES ($1, $2, $3, 'document_upload', $4::jsonb, '2026-09-01T13:00:00Z')`,
      [
        IDS.tenantA,
        IDS.processoAna,
        IDS.clienteA,
        JSON.stringify({ docId: id }),
      ],
    );
    await ds().runMigrations();
    const [v] = await ds().query<
      {
        version: number;
        status: string;
        blob_path: string;
        reviewed_by: string;
        created_at: Date;
      }[]
    >(
      `SELECT version, status, blob_path, reviewed_by, created_at FROM document_versions WHERE document_id = $1`,
      [id],
    );
    expect(v).toMatchObject({
      version: 1,
      status: 'validado',
      blob_path: 'a/b/antigo.pdf',
      reviewed_by: IDS.anaA,
    });
    expect(new Date(v.created_at).toISOString()).toBe(
      '2026-09-01T13:00:00.000Z',
    );
    await ds().query(`DELETE FROM documents WHERE id = $1`, [id]);
  });

  let doc: string;
  it('reenviar depois de uma rejeição cria a versão 2, volta para recebido e mantém a versão 1 e o arquivo dela', async () => {
    doc = await newDoc(IDS.processoAna, IDS.clienteA);
    await docs.uploadFile(doc, pdf('primeiro'), clienteA);
    await docs.update(
      doc,
      { status: 'rejeitado', validatedByNotes: 'Ilegível' },
      ana,
    );
    expect(await docRow(doc)).toMatchObject({
      status: 'rejeitado',
      validated_by_notes: 'Ilegível',
    });

    await docs.uploadFile(doc, pdf('segundo'), clienteA);
    const row = await docRow(doc);
    expect(row).toMatchObject({
      status: 'recebido',
      validated: false,
      validated_by_notes: null,
    });
    const versions = await versionRows(doc);
    expect(versions.map((v) => [v.version, v.status, v.review_notes])).toEqual([
      [1, 'rejeitado', 'Ilegível'],
      [2, 'recebido', null],
    ]);
    expect(versions[0].reviewed_by).toBe(IDS.anaA);
    expect(row.blob_path).toBe(versions[1].blob_path);
    expect(versions[0].blob_path).not.toBe(versions[1].blob_path);
    expect(storage.files.has(versions[0].blob_path)).toBe(true);

    // o histórico, do mais novo para o mais antigo, e o arquivo antigo de volta
    const list = await docs.listVersions(doc, clienteA);
    expect(
      list.map((v) => [v.version, v.current, v.status, v.uploadedByName]),
    ).toEqual([
      [2, true, 'recebido', 'Carla Cliente'],
      [1, false, 'rejeitado', 'Carla Cliente'],
    ]);
    expect(list[1]).toMatchObject({
      reviewedByName: 'Ana',
      reviewNotes: 'Ilegível',
      downloadable: true,
    });
    const old = await docs.downloadVersion(doc, list[1].id, clienteA);
    expect(await read(old.stream)).toBe('%PDF-1.4 primeiro');
    expect(old.fileName).toBe('Holerite (versão 1)');
    const current = await docs.downloadFile(doc, ana);
    expect(await read(current.stream)).toBe('%PDF-1.4 segundo');

    // o Log de Ações registra cada envio com o número da versão
    const uploads = await ds().query<{ v: number }[]>(
      `SELECT (metadata->>'version')::int AS v FROM audit_logs
        WHERE action = 'document_upload' AND metadata->>'docId' = $1 ORDER BY created_at`,
      [doc],
    );
    expect(uploads.map((u) => u.v)).toEqual([1, 2]);
  });

  it('validar vale para a versão atual: a versão 1 continua rejeitada', async () => {
    await docs.update(doc, { status: 'validado' }, ana);
    const versions = await versionRows(doc);
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [1, 'rejeitado'],
      [2, 'validado'],
    ]);
  });

  it('RN-04: um reenvio de documento validado trava o avanço até a versão nova ser validada', async () => {
    const proc = randomUUID();
    await ds().query(
      `INSERT INTO processes (id, tenant_id, client_id, analista_id, stage)
       VALUES ($1, $2, $3, $4, 'analise_credito')`,
      [proc, IDS.tenantA, CLIENTE_RN04, IDS.anaA],
    );
    const d = await newDoc(proc, CLIENTE_RN04, 'Extrato');
    await docs.uploadFile(d, pdf('extrato-1'), ana);
    await docs.update(d, { status: 'validado' }, ana);
    await docs.uploadFile(d, pdf('extrato-2'), ana);
    await expect(
      processes.advanceStage(proc, { toStage: 'credito_aprovado' }, ana),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await docs.update(d, { status: 'validado' }, ana);
    await processes.advanceStage(proc, { toStage: 'credito_aprovado' }, ana);
    const [{ stage }] = await ds().query<{ stage: string }[]>(
      `SELECT stage FROM processes WHERE id = $1`,
      [proc],
    );
    expect(stage).toBe('credito_aprovado');
  });

  it('quem vê o histórico: a equipe e o dono do documento; outro cliente não; outra assessoria nem acha', async () => {
    const [v1] = (await docs.listVersions(doc, ana)).slice(-1);
    const outro = who(IDS.tenantA, OUTRO_CLIENTE, 'cliente');
    await expect(docs.listVersions(doc, outro)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      docs.downloadVersion(doc, v1.id, outro),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(docs.listVersions(doc, gestorB)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      docs.downloadVersion(doc, v1.id, gestorB),
    ).rejects.toBeInstanceOf(NotFoundException);
    // versão de um documento acessada pela rota de outro
    const other = await newDoc(IDS.processoAna, IDS.clienteA, 'IRPF');
    await expect(
      docs.downloadVersion(other, v1.id, gestorA),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dois envios ao mesmo tempo viram as versões 1 e 2 (documento pessoal do cliente)', async () => {
    const d = await newDoc(null, IDS.clienteA, 'RG ou CNH');
    await Promise.all([
      docs.uploadFile(d, pdf('frente'), clienteA),
      docs.uploadFile(d, pdf('verso'), clienteA),
    ]);
    const versions = await versionRows(d);
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    for (const v of versions) {
      expect(v.blob_path).toMatch(
        new RegExp(`^${IDS.tenantA}/clients/${IDS.clienteA}/${d}/`),
      );
      expect(storage.files.has(v.blob_path)).toBe(true);
    }
    const list = await docs.getForProcess(IDS.processoAna, ana);
    expect(list.find((x) => x.id === d)).toMatchObject({ versionCount: 2 });
  });

  it('exclusão LGPD: sem armazenamento nada é apagado; com ele, saem os arquivos de todas as versões e os registros', async () => {
    const files = (await versionRows(doc)).map((v) => v.blob_path);
    expect(files).toHaveLength(2);

    storage.isAvailable = false;
    await expect(docs.removeDocument(doc, {}, gestorA)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(await versionRows(doc)).toHaveLength(2);
    storage.isAvailable = true;

    const res = await docs.removeDocument(
      doc,
      { reason: 'Pedido do titular' },
      gestorA,
    );
    expect(res).toEqual({ id: doc, deleted: true, fileRemoved: true });
    for (const f of files) expect(storage.files.has(f)).toBe(false);
    expect(await versionRows(doc)).toHaveLength(0);
    expect(await docRow(doc)).toBeUndefined();
    // o nome original dos arquivos sai do Log de Ações
    const [{ n }] = await ds().query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM audit_logs
        WHERE metadata->>'docId' = $1 AND metadata ? 'fileName'`,
      [doc],
    );
    expect(n).toBe(0);
  });
});
