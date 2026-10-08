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
  const manager = { delete: jest.fn(), query: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    transaction: jest
      .fn()
      .mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
  };
  const email = { sendDocumentRejected: jest.fn() };
  const webhook = { fireEvent: jest.fn() };
  const service = new DocumentsService(
    repo as unknown as Repository<Document>,
    typeRepo as unknown as Repository<DocumentType>,
    processRepo as unknown as Repository<Process>,
    userRepo as unknown as Repository<User>,
    azureStorage as never,
    dataSource as unknown as DataSource,
    email as never,
    webhook as never,
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
    email,
    webhook,
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
    const { service, repo, typeRepo, dataSource } = setup();
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
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("'documents_requested'");
    expect(params[3]).toBe(
      JSON.stringify({
        labels: ['RG ou CNH', 'Holerite (mês 1)', 'Matrícula do imóvel'],
      }),
    );
  });

  it('only accepts active catalog entries of the caller tenant (no free text)', async () => {
    const { service, repo, typeRepo } = setup();
    typeRepo.find.mockResolvedValue([RG]); // the other id is inactive or from another tenant
    await expect(
      service.requestDocuments('p1', ['ty-rg', 'ty-foreign'], caller('analista')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(typeRepo.find).toHaveBeenCalledWith({
      where: { id: expect.anything(), tenantId: 't1', active: true },
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
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1', status: 'recebido' });
    await service.update('d1', { status: 'validado' }, caller('analista', 'a1'));
    expect(repo.save).toHaveBeenCalledWith(
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
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue({ id: 'd1', tenantId: 't1', userId: 'c1', processId: null });
    await service.uploadFile('d1', file([0x25, 0x50, 0x44, 0x46, 0x2d], 'x.pdf'), caller('cliente', 'c1'));
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'recebido' }));
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
