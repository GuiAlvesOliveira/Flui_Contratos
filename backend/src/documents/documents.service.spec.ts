import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { DocumentsService } from './documents.service';
import { Document } from './document.entity';
import { DocumentType } from './document-type.entity';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
  };
  const typeRepo = { find: jest.fn() };
  const processRepo = { findOne: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const azureStorage = {
    isAvailable: false,
    upload: jest.fn(),
    download: jest.fn(),
    delete: jest.fn().mockResolvedValue(true),
  };
  const manager = {
    delete: jest.fn(),
    query: jest.fn(),
    update: jest.fn(),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest
      .fn()
      .mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
  };
  const messaging = {
    documentsRequested: jest.fn().mockResolvedValue(1),
    documentRejected: jest.fn().mockResolvedValue(1),
  };
  const service = new DocumentsService(
    repo as unknown as Repository<Document>,
    typeRepo as unknown as Repository<DocumentType>,
    processRepo as unknown as Repository<Process>,
    userRepo as unknown as Repository<User>,
    azureStorage as never,
    dataSource as unknown as DataSource,
    messaging as never,
  );
  return {
    service,
    repo,
    typeRepo,
    processRepo,
    userRepo,
    azureStorage,
    dataSource,
    manager,
    messaging,
  };
}

const caller = (role: string, userId = 'u1') =>
  ({ role, tenantId: 't1', userId }) as RequestUserFull;

const type = (id: string, label: string, category: string) =>
  ({ id, tenantId: 't1', label, category, active: true }) as DocumentType;
const RG = type('ty-rg', 'RG ou CNH', 'pessoal');
const HOLERITE = type('ty-hol', 'Holerite (mês 1)', 'renda');
const MATRICULA = type('ty-mat', 'Matrícula do imóvel', 'imovel');

describe('DocumentsService.requestDocuments (BE-03 catalog)', () => {
  const setup = () => {
    const ctx = makeService();
    ctx.processRepo.findOne.mockResolvedValue({ id: 'p1', clientId: 'cl1' });
    return ctx;
  };

  it('creates the picked documents: personal on the client, the rest on the process', async () => {
    const { service, repo, typeRepo, manager, messaging } = setup();
    typeRepo.find.mockResolvedValue([RG, HOLERITE, MATRICULA]);
    repo.find.mockResolvedValue([]);

    const res = await service.requestDocuments(
      'p1',
      ['ty-rg', 'ty-hol', 'ty-mat'],
      caller('analista'),
    );

    expect(res).toMatchObject({ created: 3, skipped: 0 });
    const saved = repo.save.mock.calls[0][0] as Partial<Document>[];
    expect(saved).toEqual([
      expect.objectContaining({
        label: 'RG ou CNH',
        category: 'pessoal',
        processId: null,
        userId: 'cl1',
        documentTypeId: 'ty-rg',
        status: 'pendente',
      }),
      expect.objectContaining({
        label: 'Holerite (mês 1)',
        category: 'renda',
        processId: 'p1',
        documentTypeId: 'ty-hol',
      }),
      expect.objectContaining({
        label: 'Matrícula do imóvel',
        category: 'imovel',
        processId: 'p1',
        documentTypeId: 'ty-mat',
      }),
    ]);
    const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'documents_requested'");
    expect(params[3]).toBe(
      JSON.stringify({
        labels: ['RG ou CNH', 'Holerite (mês 1)', 'Matrícula do imóvel'],
      }),
    );
    // BE-15_v2: the e-mail to the client goes in the same transaction
    expect(messaging.documentsRequested).toHaveBeenCalledWith(manager, {
      tenantId: 't1',
      processId: 'p1',
      clientId: 'cl1',
      labels: ['RG ou CNH', 'Holerite (mês 1)', 'Matrícula do imóvel'],
    });
  });

  it('BE-15_v2: asking again for documents already requested sends no e-mail', async () => {
    const { service, repo, typeRepo, messaging, dataSource } = setup();
    typeRepo.find.mockResolvedValue([HOLERITE]);
    repo.find.mockResolvedValue([
      { documentTypeId: 'ty-hol', processId: 'p1' },
    ]);
    const res = await service.requestDocuments(
      'p1',
      ['ty-hol'],
      caller('analista'),
    );
    expect(res).toMatchObject({ created: 0, skipped: 1 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(messaging.documentsRequested).not.toHaveBeenCalled();
  });

  it('only accepts active catalog entries of the caller tenant (no free text)', async () => {
    const { service, repo, typeRepo } = setup();
    typeRepo.find.mockResolvedValue([RG]); // the other id is inactive or from another tenant
    await expect(
      service.requestDocuments(
        'p1',
        ['ty-rg', 'ty-foreign'],
        caller('analista'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(typeRepo.find).toHaveBeenCalledWith({
      where: { id: expect.anything() as unknown, tenantId: 't1', active: true },
    });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('skips what was already requested, including old rows linked only by label', async () => {
    const { service, repo, typeRepo, dataSource } = setup();
    typeRepo.find.mockResolvedValue([RG, HOLERITE]);
    repo.find.mockResolvedValue([
      { id: 'd1', processId: null, documentTypeId: 'ty-rg' },
      {
        id: 'd2',
        processId: 'p1',
        documentTypeId: null,
        label: 'holerite (MÊS 1)',
      },
    ]);
    const res = await service.requestDocuments(
      'p1',
      ['ty-rg', 'ty-hol'],
      caller('analista'),
    );
    expect(res).toMatchObject({ created: 0, skipped: 2 });
    expect(dataSource.query).not.toHaveBeenCalled(); // nothing new, no audit entry
  });

  it('404s when the process is not in the caller tenant', async () => {
    const { service, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue(null);
    await expect(
      service.requestDocuments('p1', ['ty-rg'], caller('analista')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentsService.removeDocument (BE-10, LGPD)', () => {
  const withFile = {
    id: 'd1',
    tenantId: 't1',
    processId: 'p1',
    userId: 'cl1',
    label: 'Holerite (mês 1)',
    category: 'renda',
    blobPath: 't1/p1/d1.pdf',
  };

  it('deletes the file in storage, the record, and the file name from old audit entries', async () => {
    const { service, repo, azureStorage, manager } = makeService();
    azureStorage.isAvailable = true;
    repo.findOne.mockResolvedValue({ ...withFile });

    const res = await service.removeDocument(
      'd1',
      { reason: '  Pedido do titular  ' },
      caller('dono'),
    );

    expect(res).toEqual({ id: 'd1', deleted: true, fileRemoved: true });
    expect(azureStorage.delete).toHaveBeenCalledWith('t1/p1/d1.pdf');
    expect(manager.delete).toHaveBeenCalledWith(Document, {
      id: 'd1',
      tenantId: 't1',
    });
    const [scrubSql, scrubParams] = manager.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    expect(scrubSql).toContain("metadata - 'fileName'");
    expect(scrubParams).toEqual(['t1', 'd1']);
    const [auditSql, auditParams] = manager.query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(auditSql).toContain("'document_deleted'");
    expect(auditParams.slice(0, 3)).toEqual(['t1', 'p1', 'u1']);
    expect(JSON.parse(auditParams[3] as string)).toEqual({
      docId: 'd1',
      label: 'Holerite (mês 1)',
      category: 'renda',
      hadFile: true,
      reason: 'Pedido do titular',
    });
  });

  it('removes nothing if the storage is unavailable while the file exists', async () => {
    const { service, repo, azureStorage, dataSource } = makeService();
    azureStorage.isAvailable = false;
    repo.findOne.mockResolvedValue({ ...withFile });
    await expect(
      service.removeDocument('d1', {}, caller('analista')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(azureStorage.delete).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('a request without file is just removed (no storage call)', async () => {
    const { service, repo, azureStorage, manager } = makeService();
    repo.findOne.mockResolvedValue({ ...withFile, blobPath: null });
    const res = await service.removeDocument('d1', {}, caller('analista'));
    expect(res).toEqual({ id: 'd1', deleted: true, fileRemoved: false });
    expect(azureStorage.delete).not.toHaveBeenCalled();
    expect(manager.delete).toHaveBeenCalled();
  });

  it('logs a personal document on the viewed process only if it belongs to the same client', async () => {
    const { service, repo, processRepo, manager } = makeService();
    repo.findOne.mockResolvedValue({
      ...withFile,
      processId: null,
      blobPath: null,
    });
    processRepo.findOne.mockResolvedValue({ id: 'p9' });
    await service.removeDocument('d1', { processId: 'p9' }, caller('analista'));
    expect(processRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'p9', tenantId: 't1', clientId: 'cl1' },
    });
    const audit = manager.query.mock.calls[1] as [string, unknown[]];
    expect(audit[1][1]).toBe('p9');
  });

  it('404s for a document outside the caller tenant', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.removeDocument('d1', {}, caller('dono')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentsService.update (authorization)', () => {
  it('FE-22: validating a process document writes it to the activity log', async () => {
    const { service, repo, dataSource } = makeService();
    repo.findOne.mockResolvedValue({
      id: 'd1',
      tenantId: 't1',
      processId: 'p1',
      userId: 'cl1',
      label: 'Holerite (mês 1)',
    });
    await service.update('d1', { status: 'validado' }, caller('analista'));
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(params).toEqual([
      't1',
      'p1',
      'u1',
      'document_validated',
      JSON.stringify({ docId: 'd1', label: 'Holerite (mês 1)' }),
    ]);
  });

  it('a rejected document queues an e-mail to its client with the analista note', async () => {
    const { service, repo, manager, messaging } = makeService();
    repo.findOne.mockResolvedValueOnce({
      id: 'd1',
      tenantId: 't1',
      processId: null, // personal doc: no audit entry, but the client is still told
      userId: 'cl1',
      label: 'RG',
    });
    await service.update(
      'd1',
      { status: 'rejeitado', notes: 'Foto ilegível' },
      caller('analista'),
    );
    expect(messaging.documentRejected).toHaveBeenCalledWith(manager, {
      tenantId: 't1',
      processId: null,
      clientId: 'cl1',
      label: 'RG',
      notes: 'Foto ilegível',
    });

    messaging.documentRejected.mockClear();
    repo.findOne.mockResolvedValueOnce({
      id: 'd2',
      tenantId: 't1',
      processId: null,
      userId: 'cl1',
      label: 'RG',
    });
    await service.update('d2', { status: 'validado' }, caller('analista'));
    expect(messaging.documentRejected).not.toHaveBeenCalled();
  });

  it('the reason typed on the screen (validatedByNotes) goes to the e-mail', async () => {
    const { service, repo, manager, messaging } = makeService();
    repo.findOne.mockResolvedValueOnce({
      id: 'd1', tenantId: 't1', processId: 'p1', userId: 'cl1', label: 'Holerite', notes: 'nota antiga do cliente',
    });
    await service.update(
      'd1',
      { status: 'rejeitado', validatedByNotes: 'Documento inválido ou ilegível' },
      caller('analista'),
    );
    expect(messaging.documentRejected).toHaveBeenCalledWith(manager, {
      tenantId: 't1',
      processId: 'p1',
      clientId: 'cl1',
      label: 'Holerite',
      notes: 'Documento inválido ou ilegível',
    });
  });

  it('FE-22: rejection is logged too; personal docs and notes-only edits are not', async () => {
    const { service, repo, dataSource } = makeService();
    repo.findOne.mockResolvedValueOnce({
      id: 'd1',
      tenantId: 't1',
      processId: 'p1',
      label: 'IRPF',
    });
    await service.update('d1', { status: 'rejeitado' }, caller('dono'));
    expect((dataSource.query.mock.calls[0] as [string, unknown[]])[1][3]).toBe(
      'document_rejected',
    );
    dataSource.query.mockClear();
    repo.findOne.mockResolvedValueOnce({
      id: 'd2',
      tenantId: 't1',
      processId: null,
      label: 'RG',
    });
    await service.update('d2', { status: 'validado' }, caller('analista'));
    repo.findOne.mockResolvedValueOnce({
      id: 'd3',
      tenantId: 't1',
      processId: 'p1',
      label: 'RG',
    });
    await service.update('d3', { notes: 'ok' }, caller('analista'));
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('forbids a cliente from touching a document that is not theirs', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'someone-else' });
    await expect(
      service.update('d1', { status: 'recebido' }, caller('cliente', 'c1')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forbids a cliente from setting any status other than "recebido"', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1' });
    await expect(
      service.update('d1', { status: 'validado' }, caller('cliente', 'c1')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an analista validate a document (stamps validatedBy/validatedAt)', async () => {
    const { service, repo, manager } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1', status: 'recebido' });
    await service.update('d1', { status: 'validado' }, caller('analista', 'a1'));
    // PROD-12: saved together with the current file version, in one transaction
    expect(manager.update).toHaveBeenCalledWith(
      Document,
      { id: 'd1', tenantId: 't1' },
      expect.objectContaining({ status: 'validado', validated: true, validatedBy: 'a1' }),
    );
  });

  it('404s for an unknown document', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.update('d1', { status: 'validado' }, caller('analista', 'a1')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentsService.uploadFile (SEC-05 content validation)', () => {
  const file = (bytes: number[], name = 'x.bin') =>
    ({ buffer: Buffer.from(bytes), originalname: name, mimetype: 'application/octet-stream' }) as unknown as Express.Multer.File;

  it('rejects when no file is sent', async () => {
    const { service } = makeService();
    await expect(
      service.uploadFile('d1', undefined as unknown as Express.Multer.File, caller('analista', 'a1')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a file whose real bytes are not PDF/JPEG/PNG (disguised content)', async () => {
    const { service } = makeService();
    await expect(
      service.uploadFile('d1', file([0x00, 0x01, 0x02, 0x03]), caller('analista', 'a1')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a genuine PDF and marks the doc as recebido', async () => {
    const { service, repo, manager } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1', processId: null });
    manager.query.mockResolvedValue([{ version: 1 }]);
    await service.uploadFile('d1', file([0x25, 0x50, 0x44, 0x46, 0x2d], 'x.pdf'), caller('cliente', 'c1'));
    // PROD-12: saved together with the new file version, in one transaction
    expect(manager.update).toHaveBeenCalledWith(Document, { id: 'd1', tenantId: 't1' }, expect.objectContaining({ status: 'recebido' }));
  });

  it('forbids a cliente from uploading to a document that is not theirs', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'other', processId: null });
    await expect(
      service.uploadFile('d1', file([0x25, 0x50, 0x44, 0x46], 'x.pdf'), caller('cliente', 'c1')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('DocumentsService.getForProcess', () => {
  it('returns personal docs followed by process docs', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', clientId: 'cl1' });
    repo.find
      .mockResolvedValueOnce([{ id: 'proc-doc' }]) // process docs
      .mockResolvedValueOnce([{ id: 'personal-doc' }]); // personal docs
    const res = await service.getForProcess('p1', caller('analista'));
    expect(res).toEqual([{ id: 'personal-doc' }, { id: 'proc-doc' }]);
  });
});

describe('DocumentsService — versões do arquivo (PROD-12)', () => {
  const pdf = { buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), originalname: 'holerite.pdf', mimetype: 'application/pdf', size: 5 } as unknown as Express.Multer.File;
  const rejected = () => ({
    id: 'd1', tenantId: 't1', userId: 'c1', processId: 'p1', label: 'Holerite',
    blobPath: 't1/p1/d1/old.pdf', status: 'rejeitado', validated: false,
    validatedBy: 'a1', validatedAt: new Date(), validatedByNotes: 'Ilegível',
  });

  it('reenviar cria uma versão nova com arquivo próprio, sem apagar a anterior, e volta para recebido', async () => {
    const { service, repo, azureStorage, manager } = makeService();
    azureStorage.isAvailable = true;
    azureStorage.upload.mockImplementation((name: string) => Promise.resolve(name));
    repo.findOne.mockResolvedValue(rejected());
    manager.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ version: 2 }]).mockResolvedValue([]);
    await service.uploadFile('d1', pdf, caller('cliente', 'c1'));

    const [name] = azureStorage.upload.mock.calls[0] as [string];
    expect(name).toMatch(/^t1\/p1\/d1\/[0-9a-f-]{36}\.pdf$/);
    expect(azureStorage.delete).not.toHaveBeenCalled();
    const sqls = manager.query.mock.calls.map(([q]) => String(q));
    expect(sqls[0]).toContain('FOR UPDATE');
    expect(sqls[1]).toContain('COALESCE(MAX(version), 0) + 1');
    expect((manager.query.mock.calls[1] as [string, unknown[]])[1]).toEqual(['t1', 'd1', name, 'application/pdf', 5, 'c1']);
    expect(manager.update).toHaveBeenCalledWith(Document, { id: 'd1', tenantId: 't1' }, expect.objectContaining({
      blobPath: name, status: 'recebido', validated: false, validatedBy: null, validatedAt: null, validatedByNotes: null,
      mimeType: 'application/pdf', sizeBytes: 5, uploadedBy: 'c1',
    }));
    const audit = manager.query.mock.calls[2] as [string, unknown[]];
    expect(audit[0]).toContain("'document_upload'");
    expect(JSON.parse(audit[1][3] as string)).toEqual({ docId: 'd1', label: 'Holerite', fileName: 'holerite.pdf', version: 2 });
  });

  it('se a versão não é gravada, o arquivo recém-enviado é apagado (nada fica órfão)', async () => {
    const { service, repo, azureStorage, manager } = makeService();
    azureStorage.isAvailable = true;
    azureStorage.upload.mockImplementation((name: string) => Promise.resolve(name));
    repo.findOne.mockResolvedValue(rejected());
    manager.query.mockRejectedValue(new Error('banco fora'));
    await expect(service.uploadFile('d1', pdf, caller('analista', 'a1'))).rejects.toThrow('banco fora');
    expect(azureStorage.delete).toHaveBeenCalledWith((azureStorage.upload.mock.calls[0] as [string])[0]);
  });

  it('validar ou rejeitar grava o resultado na versão atual, na mesma transação', async () => {
    const { service, repo, manager } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1', processId: 'p1', status: 'recebido' });
    await service.update('d1', { status: 'rejeitado', validatedByNotes: 'Ilegível' }, caller('analista', 'a1'));
    const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE document_versions');
    expect(sql).toContain('ORDER BY version DESC LIMIT 1');
    expect(params).toEqual(['rejeitado', 'a1', 'Ilegível', 'd1', 't1']);
    manager.query.mockClear();
    await service.update('d1', { notes: 'só uma anotação' }, caller('analista', 'a1'));
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('histórico: a versão mais nova é a atual; o cliente só vê os próprios documentos', async () => {
    const { service, repo, dataSource } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1', label: 'Holerite' });
    dataSource.query.mockResolvedValueOnce([
      { id: 'v2', version: 2, created_at: new Date('2026-10-20T12:00:00Z'), mime_type: 'application/pdf', size_bytes: '2048', status: 'recebido', reviewed_at: null, review_notes: null, downloadable: true, uploaded_by_name: 'Helena', reviewed_by_name: null },
      { id: 'v1', version: 1, created_at: new Date('2026-10-19T12:00:00Z'), mime_type: null, size_bytes: null, status: 'rejeitado', reviewed_at: new Date('2026-10-19T15:00:00Z'), review_notes: 'Ilegível', downloadable: true, uploaded_by_name: 'Helena', reviewed_by_name: 'Ana' },
    ]);
    const list = await service.listVersions('d1', caller('cliente', 'c1'));
    expect(list.map((v) => [v.version, v.current, v.status, v.sizeBytes])).toEqual([[2, true, 'recebido', 2048], [1, false, 'rejeitado', null]]);
    expect(list[1]).toMatchObject({ reviewedByName: 'Ana', reviewNotes: 'Ilegível', uploadedByName: 'Helena' });
    expect((dataSource.query.mock.calls[0] as [string, unknown[]])[1]).toEqual(['d1', 't1']);

    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'outro' });
    await expect(service.listVersions('d1', caller('cliente', 'c1'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.downloadVersion('d1', 'v1', caller('cliente', 'c1'))).rejects.toBeInstanceOf(ForbiddenException);
    repo.findOne.mockResolvedValue(null);
    await expect(service.listVersions('d1', caller('dono'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('baixar uma versão antiga: arquivo da versão, com o número no nome; versão de outro documento = 404', async () => {
    const { service, repo, dataSource, azureStorage } = makeService();
    azureStorage.isAvailable = true;
    azureStorage.download.mockResolvedValue({ stream: 'S', contentType: 'application/pdf', contentLength: 3 });
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1', label: 'Holerite' });
    dataSource.query.mockResolvedValueOnce([{ blob_path: 't1/p1/d1.pdf', version: 1 }]);
    const file = await service.downloadVersion('d1', 'v1', caller('analista'));
    expect(azureStorage.download).toHaveBeenCalledWith('t1/p1/d1.pdf');
    expect(file.fileName).toBe('Holerite (versão 1)');
    expect((dataSource.query.mock.calls[0] as [string, unknown[]])[1]).toEqual(['v1', 'd1', 't1']);
    dataSource.query.mockResolvedValueOnce([]);
    await expect(service.downloadVersion('d1', 'v9', caller('analista'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exclusão LGPD apaga o arquivo de todas as versões (sem repetir o atual) antes do registro', async () => {
    const { service, repo, dataSource, azureStorage, manager } = makeService();
    azureStorage.isAvailable = true;
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', processId: 'p1', userId: 'c1', label: 'Holerite', blobPath: 't1/p1/d1/v3.pdf' });
    dataSource.query.mockResolvedValueOnce([
      { blob_path: 't1/p1/d1.pdf' }, { blob_path: 't1/p1/d1/v2.pdf' }, { blob_path: 't1/p1/d1/v3.pdf' }, { blob_path: 'local://t1/p1/d1/x.pdf' },
    ]);
    const res = await service.removeDocument('d1', {}, caller('dono'));
    expect(azureStorage.delete.mock.calls.map(([p]) => p as string)).toEqual(['t1/p1/d1/v3.pdf', 't1/p1/d1.pdf', 't1/p1/d1/v2.pdf']);
    expect(manager.delete).toHaveBeenCalledWith(Document, { id: 'd1', tenantId: 't1' });
    expect(res).toEqual({ id: 'd1', deleted: true, fileRemoved: true });

    // armazenamento fora: nada é apagado, nem as versões
    const again = makeService();
    again.azureStorage.isAvailable = false;
    again.repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', processId: 'p1', blobPath: null });
    again.dataSource.query.mockResolvedValueOnce([{ blob_path: 't1/p1/d1.pdf' }]);
    await expect(again.service.removeDocument('d1', {}, caller('dono'))).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(again.dataSource.transaction).not.toHaveBeenCalled();
  });

  it('a lista de documentos informa quantas versões cada um tem', async () => {
    const { service, repo, processRepo, dataSource } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', clientId: 'cl1' });
    repo.find.mockResolvedValueOnce([{ id: 'd2' }]).mockResolvedValueOnce([{ id: 'd1' }]);
    dataSource.query.mockResolvedValueOnce([{ document_id: 'd2', n: 3 }]);
    expect(await service.getForProcess('p1', caller('analista'))).toEqual([{ id: 'd1' }, { id: 'd2', versionCount: 3 }]);
    expect((dataSource.query.mock.calls[0] as [string, unknown[]])[1]).toEqual(['t1', ['d1', 'd2']]);
  });
});
