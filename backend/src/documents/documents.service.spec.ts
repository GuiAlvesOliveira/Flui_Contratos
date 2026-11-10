import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { DocumentsService } from './documents.service';
import { Document } from './document.entity';
import { DocumentType } from './document-type.entity';
import { Process } from '../processes/process.entity';
import { User } from '../users/user.entity';
import { RequestUserFull } from '../auth/supabase.guard';
import { computeValidUntil, todayInSaoPaulo } from './document-validity';

function makeService() {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
  };
  const typeRepo = { find: jest.fn(), findOne: jest.fn() };
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
  it('FE-22: validating a process document writes it to the activity log, in the same transaction', async () => {
    const { service, repo, dataSource, manager } = makeService();
    repo.findOne.mockResolvedValue({
      id: 'd1',
      tenantId: 't1',
      processId: 'p1',
      userId: 'cl1',
      label: 'Holerite (mês 1)',
    });
    await service.update('d1', { status: 'validado' }, caller('analista'));
    const [sql, params] = manager.query.mock.calls.find(([q]) =>
      String(q).includes('INSERT INTO audit_logs'),
    ) as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(params).toEqual([
      't1',
      'p1',
      'u1',
      'document_validated',
      JSON.stringify({ docId: 'd1', label: 'Holerite (mês 1)' }),
    ]);
    expect(dataSource.query).not.toHaveBeenCalled();
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

  it('FE-22: rejection is logged too; a personal doc goes to the process on screen; notes-only edits are not logged', async () => {
    const { service, repo, manager, processRepo } = makeService();
    const audits = () =>
      manager.query.mock.calls.filter(([q]) =>
        String(q).includes('INSERT INTO audit_logs'),
      ) as [string, unknown[]][];
    repo.findOne.mockResolvedValueOnce({
      id: 'd1',
      tenantId: 't1',
      processId: 'p1',
      label: 'IRPF',
    });
    await service.update('d1', { status: 'rejeitado' }, caller('dono'));
    expect(audits()[0][1][3]).toBe('document_rejected');

    // personal doc (serves every process of the client): logged on the process
    // being viewed, once it is confirmed to be this client's
    manager.query.mockClear();
    repo.findOne.mockResolvedValueOnce({
      id: 'd2',
      tenantId: 't1',
      processId: null,
      userId: 'cl1',
      label: 'RG',
    });
    processRepo.findOne.mockResolvedValueOnce({ id: 'p9' });
    await service.update(
      'd2',
      { status: 'validado', processId: 'p9' },
      caller('analista'),
    );
    expect(processRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'p9', tenantId: 't1', clientId: 'cl1' },
    });
    expect(audits()[0][1].slice(1, 4)).toEqual(['p9', 'u1', 'document_validated']);

    // a process that is not this client's is not trusted: no process attached
    manager.query.mockClear();
    repo.findOne.mockResolvedValueOnce({
      id: 'd2',
      tenantId: 't1',
      processId: null,
      userId: 'cl1',
      label: 'RG',
    });
    processRepo.findOne.mockResolvedValueOnce(null);
    await service.update(
      'd2',
      { status: 'validado', processId: 'p-de-outro-cliente' },
      caller('analista'),
    );
    expect(audits()[0][1][1]).toBeNull();

    manager.query.mockClear();
    repo.findOne.mockResolvedValueOnce({
      id: 'd3',
      tenantId: 't1',
      processId: 'p1',
      label: 'RG',
    });
    await service.update('d3', { notes: 'ok' }, caller('analista'));
    expect(audits()).toHaveLength(0);
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

// ── Validade pelo mês de referência ─────────────────────────────────────────

const TODAY = todayInSaoPaulo();
const THIS_MONTH = TODAY.slice(0, 7);
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);

describe('DocumentsService — validade pelo mês de referência', () => {
  const holerite = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    tenantId: 't1',
    processId: 'p1',
    userId: 'cl1',
    label: 'Holerite (mês 1)',
    status: 'recebido',
    documentTypeId: 'ty-hol',
    referenceMonth: null,
    ...over,
  });
  const setup = (validityMonths: number | null = 3) => {
    const ctx = makeService();
    ctx.typeRepo.findOne.mockResolvedValue({
      id: 'ty-hol',
      tenantId: 't1',
      validityMonths,
    });
    return ctx;
  };
  const auditOf = (manager: { query: jest.Mock }) =>
    manager.query.mock.calls.find(([q]) =>
      String(q).includes('INSERT INTO audit_logs'),
    ) as [string, unknown[]];

  it('bloqueia a aprovação sem mês de referência quando o tipo tem prazo — nada é gravado', async () => {
    const { service, repo, typeRepo, dataSource, manager } = setup(3);
    repo.findOne.mockResolvedValue(holerite());
    await expect(
      service.update('d1', { status: 'validado' }, caller('analista')),
    ).rejects.toThrow(
      new BadRequestException(
        'Informe o mês de referência do documento (MM/AAAA) para validá-lo',
      ),
    );
    // o prazo vem da lista da assessoria, sempre dentro do tenant
    expect(typeRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'ty-hol', tenantId: 't1' },
    });
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('não aceita mês de referência no futuro', async () => {
    const { service, repo, manager } = setup(3);
    repo.findOne.mockResolvedValue(holerite());
    await expect(
      service.update(
        'd1',
        { status: 'validado', referenceMonth: shiftMonth(THIS_MONTH, 1) },
        caller('analista'),
      ),
    ).rejects.toThrow(
      new BadRequestException(
        'O mês de referência não pode ser depois do mês atual',
      ),
    );
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('não aprova documento que já nasce vencido (o caminho é rejeitar e pedir outro)', async () => {
    const { service, repo, manager } = setup(3);
    repo.findOne.mockResolvedValue(holerite());
    const attempt = () =>
      service.update(
        'd1',
        { status: 'validado', referenceMonth: '01/2020' },
        caller('analista'),
      );
    await expect(attempt()).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(attempt()).rejects.toThrow('ele valia até 30/04/2020');
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('aprovar com o mês grava o vencimento calculado, quem informou e quando — na mesma transação da validação', async () => {
    const { service, repo, manager } = setup(3);
    repo.findOne.mockResolvedValue(holerite());
    const [y, m] = THIS_MONTH.split('-');
    await service.update(
      'd1',
      { status: 'validado', referenceMonth: `${m}/${y}` },
      caller('analista', 'a1'),
    );
    const until = computeValidUntil(THIS_MONTH, 3);
    expect(manager.update).toHaveBeenCalledWith(
      Document,
      { id: 'd1', tenantId: 't1' },
      expect.objectContaining({
        status: 'validado',
        validated: true,
        validatedBy: 'a1',
        referenceMonth: `${THIS_MONTH}-01`,
        validUntil: until,
        validityMonths: 3,
        referenceMonthSetBy: 'a1',
        referenceMonthSetAt: expect.any(Date) as Date,
        expiredAt: null,
      }),
    );
    const version = manager.query.mock.calls.find(([q]) =>
      String(q).includes('SET reference_month'),
    ) as [string, unknown[]];
    expect(version[1]).toEqual([`${THIS_MONTH}-01`, until, 'd1', 't1']);
    // um ciclo novo: os avisos do ciclo anterior deixam de ser pendentes
    const resolved = manager.query.mock.calls.find(([q]) =>
      String(q).includes('UPDATE notifications SET resolved_at'),
    ) as [string, unknown[]];
    expect(resolved[0]).toContain('valid_until IS DISTINCT FROM $3::date');
    expect(resolved[1]).toEqual(['t1', 'd1', until]);
    // RN-07: quem informou o mês e quando (ator + data do registro)
    const [, params] = auditOf(manager);
    expect(params.slice(0, 4)).toEqual([
      't1',
      'p1',
      'a1',
      'document_validated',
    ]);
    expect(JSON.parse(params[4] as string)).toEqual({
      docId: 'd1',
      label: 'Holerite (mês 1)',
      referenceMonth: THIS_MONTH,
      validUntil: until,
      validityMonths: 3,
    });
  });

  it('tipo sem prazo (RG, CPF) continua como hoje: aprova sem mês, e um mês enviado é ignorado', async () => {
    const { service, repo, manager } = setup(null);
    repo.findOne.mockResolvedValue(
      holerite({ label: 'RG ou CNH', documentTypeId: 'ty-rg' }),
    );
    await service.update('d1', { status: 'validado' }, caller('analista'));
    expect(manager.update).toHaveBeenCalledWith(
      Document,
      { id: 'd1', tenantId: 't1' },
      expect.objectContaining({
        status: 'validado',
        referenceMonth: null,
        validUntil: null,
      }),
    );
    manager.update.mockClear();
    await service.update(
      'd1',
      { status: 'validado', referenceMonth: '01/2020' },
      caller('analista'),
    );
    expect(manager.update).toHaveBeenCalledWith(
      Document,
      { id: 'd1', tenantId: 't1' },
      expect.objectContaining({ status: 'validado', referenceMonth: null }),
    );
    expect(
      manager.query.mock.calls.some(([q]) =>
        String(q).includes('SET reference_month'),
      ),
    ).toBe(false);
  });

  it('documento sem item da lista (anterior ao catálogo) ou formulário não pede mês', async () => {
    const { service, repo, typeRepo, manager } = setup(3);
    repo.findOne.mockResolvedValue(holerite({ documentTypeId: null }));
    await service.update('d1', { status: 'validado' }, caller('analista'));
    repo.findOne.mockResolvedValue(holerite({ formType: 'dps' }));
    await service.update('d1', { status: 'validado' }, caller('analista'));
    expect(typeRepo.findOne).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledTimes(2);
  });

  it('só a equipe informa o mês de referência', async () => {
    const { service, repo } = setup(3);
    repo.findOne.mockResolvedValue(holerite({ userId: 'c1' }));
    await expect(
      service.update(
        'd1',
        { referenceMonth: THIS_MONTH },
        caller('cliente', 'c1'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejeitar limpa a validade (o ciclo é da versão validada)', async () => {
    const { service, repo, manager } = setup(3);
    repo.findOne.mockResolvedValue(
      holerite({
        status: 'validado',
        referenceMonth: `${THIS_MONTH}-01`,
        validUntil: '2099-01-31',
      }),
    );
    await service.update(
      'd1',
      { status: 'rejeitado', validatedByNotes: 'Ilegível' },
      caller('analista'),
    );
    expect(manager.update).toHaveBeenCalledWith(
      Document,
      { id: 'd1', tenantId: 't1' },
      expect.objectContaining({
        status: 'rejeitado',
        referenceMonth: null,
        validUntil: null,
        validityMonths: null,
        expiredAt: null,
      }),
    );
  });

  it('um arquivo novo volta para "recebido" sem a validade do anterior', async () => {
    const { service, repo, manager } = setup(3);
    repo.findOne.mockResolvedValue(
      holerite({
        status: 'validado',
        referenceMonth: '2026-01-01',
        validUntil: '2026-04-30',
      }),
    );
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ version: 2 }])
      .mockResolvedValue([]);
    const pdf = {
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
      originalname: 'holerite.pdf',
      mimetype: 'application/pdf',
      size: 5,
    } as unknown as Express.Multer.File;
    await service.uploadFile('d1', pdf, caller('cliente', 'cl1'));
    expect(manager.update).toHaveBeenCalledWith(
      Document,
      { id: 'd1', tenantId: 't1' },
      expect.objectContaining({
        status: 'recebido',
        referenceMonth: null,
        validUntil: null,
        expiredAt: null,
      }),
    );
  });

  it('documento validado antes da regra: o analista informa o mês depois — mesmo vencido — com registro próprio', async () => {
    const { service, repo, manager } = setup(6);
    repo.findOne.mockResolvedValue(
      holerite({
        status: 'validado',
        label: 'Extrato Bancário (mês 1)',
        referenceMonth: null,
      }),
    );
    await service.update(
      'd1',
      { referenceMonth: '01/2020' },
      caller('analista', 'a1'),
    );
    expect(manager.update).toHaveBeenCalledWith(
      Document,
      { id: 'd1', tenantId: 't1' },
      expect.objectContaining({
        status: 'validado',
        referenceMonth: '2020-01-01',
        validUntil: '2020-07-31',
        validityMonths: 6,
        referenceMonthSetBy: 'a1',
        expiredAt: null,
      }),
    );
    const [, params] = auditOf(manager);
    expect(params.slice(0, 4)).toEqual([
      't1',
      'p1',
      'a1',
      'document_reference_month_set',
    ]);
    expect(JSON.parse(params[4] as string)).toEqual({
      docId: 'd1',
      label: 'Extrato Bancário (mês 1)',
      referenceMonth: '2020-01',
      validUntil: '2020-07-31',
      validityMonths: 6,
      previousReferenceMonth: null,
    });
    // corrigir: o registro guarda o mês anterior; futuro continua recusado
    manager.query.mockClear();
    repo.findOne.mockResolvedValue(
      holerite({
        status: 'validado',
        referenceMonth: '2020-01-01',
        validUntil: '2020-07-31',
      }),
    );
    await service.update(
      'd1',
      { referenceMonth: THIS_MONTH },
      caller('analista', 'a1'),
    );
    expect(JSON.parse(auditOf(manager)[1][4] as string)).toMatchObject({
      referenceMonth: THIS_MONTH,
      previousReferenceMonth: '2020-01',
    });
    await expect(
      service.update(
        'd1',
        { referenceMonth: shiftMonth(THIS_MONTH, 2) },
        caller('analista'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('o mês sozinho só vale para documento já validado e de tipo com prazo', async () => {
    const { service, repo, typeRepo } = setup(3);
    repo.findOne.mockResolvedValue(holerite({ status: 'recebido' }));
    await expect(
      service.update('d1', { referenceMonth: THIS_MONTH }, caller('analista')),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    typeRepo.findOne.mockResolvedValue({
      id: 'ty-rg',
      tenantId: 't1',
      validityMonths: null,
    });
    repo.findOne.mockResolvedValue(
      holerite({ status: 'validado', documentTypeId: 'ty-rg' }),
    );
    await expect(
      service.update('d1', { referenceMonth: THIS_MONTH }, caller('analista')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('o checklist traz a situação de cada documento: vencendo, vencido e "mês de referência não informado"', async () => {
    const { service, repo, processRepo, typeRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', clientId: 'cl1' });
    const rg = {
      id: 'e',
      status: 'validado',
      documentTypeId: 'ty-rg',
      validUntil: null,
    };
    repo.find
      .mockResolvedValueOnce([
        {
          id: 'a',
          status: 'validado',
          documentTypeId: 'ty-hol',
          validUntil: addDays(TODAY, 10),
        },
        {
          id: 'b',
          status: 'validado',
          documentTypeId: 'ty-ext',
          validUntil: addDays(TODAY, -3),
        },
        { id: 'c', status: 'validado', documentTypeId: 'ty-hol', validUntil: null },
        { id: 'd', status: 'recebido', documentTypeId: 'ty-hol', validUntil: null },
        {
          id: 'f',
          status: 'validado',
          documentTypeId: 'ty-ext',
          validUntil: addDays(TODAY, 40),
        },
        rg,
      ])
      .mockResolvedValueOnce([]);
    typeRepo.find.mockResolvedValue([
      { id: 'ty-hol', validityMonths: 3 },
      { id: 'ty-ext', validityMonths: 6 },
      { id: 'ty-rg', validityMonths: null },
    ]);
    const res = await service.getForProcess('p1', caller('analista'));
    expect(res).toEqual([
      expect.objectContaining({
        id: 'a',
        typeValidityMonths: 3,
        validityStatus: 'vencendo',
        daysLeft: 10,
      }),
      expect.objectContaining({
        id: 'b',
        typeValidityMonths: 6,
        validityStatus: 'vencido',
        daysLeft: -3,
      }),
      expect.objectContaining({
        id: 'c',
        typeValidityMonths: 3,
        validityStatus: 'sem_referencia',
      }),
      expect.objectContaining({
        id: 'd',
        typeValidityMonths: 3,
        validityStatus: null,
      }),
      expect.objectContaining({ id: 'f', validityStatus: 'valido', daysLeft: 40 }),
      rg, // tipo sem prazo: igual a hoje
    ]);
  });
});
