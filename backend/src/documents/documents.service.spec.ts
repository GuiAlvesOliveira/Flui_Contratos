import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
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
  const service = new DocumentsService(
    repo as unknown as Repository<Document>,
    typeRepo as unknown as Repository<DocumentType>,
    processRepo as unknown as Repository<Process>,
    userRepo as unknown as Repository<User>,
    azureStorage as never,
    dataSource as unknown as DataSource,
    email as never,
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

describe('DocumentsService.update (authorization)', () => {
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
