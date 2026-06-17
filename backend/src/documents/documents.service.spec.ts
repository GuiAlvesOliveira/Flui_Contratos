import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { DocumentsService } from './documents.service';
import { Document } from './document.entity';
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
  const processRepo = { findOne: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const azureStorage = { isAvailable: false, upload: jest.fn(), download: jest.fn() };
  const dataSource = { query: jest.fn() };
  const email = { sendDocumentRejected: jest.fn() };
  const service = new DocumentsService(
    repo as unknown as Repository<Document>,
    processRepo as unknown as Repository<Process>,
    userRepo as unknown as Repository<User>,
    azureStorage as never,
    dataSource as unknown as DataSource,
    email as never,
  );
  return { service, repo, processRepo, userRepo, azureStorage, dataSource, email };
}

const caller = (role: string, userId = 'u1') =>
  ({ role, tenantId: 't1', userId } as RequestUserFull);

// docTypes hardcoded to mirror the service templates (not exported).
const PERSONAL = ['rg_cnh', 'comprovante_endereco', 'cert_estado_civil'];
const ASSALARIADO = ['holerite_1', 'holerite_2', 'holerite_3', 'irpf'];

describe('DocumentsService.initChecklist (RN-04 checklist source)', () => {
  it('creates personal + income docs for an assalariado process', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', clientId: 'cl1', fonteRenda: 'assalariado' });
    repo.find.mockResolvedValue([]); // nothing existing yet (personal + process queries)

    const res = await service.initChecklist('p1', caller('analista'));

    expect(res).toEqual({ created: 7 }); // 3 personal + 4 assalariado
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('uses the 6-month income template when the source is not assalariado', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', clientId: 'cl1', fonteRenda: 'nao_assalariado' });
    repo.find.mockResolvedValue([]);

    const res = await service.initChecklist('p1', caller('analista'));

    expect(res).toEqual({ created: 10 }); // 3 personal + 6 extratos + irpf = 10
  });

  it('is idempotent — re-running creates nothing when the checklist already exists', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', clientId: 'cl1', fonteRenda: 'assalariado' });
    repo.find
      .mockResolvedValueOnce(PERSONAL.map((docType) => ({ docType }))) // existing personal
      .mockResolvedValueOnce(ASSALARIADO.map((docType) => ({ docType }))); // existing income

    const res = await service.initChecklist('p1', caller('analista'));

    expect(res).toEqual({ created: 0, message: 'Checklist já inicializado' });
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('404s when the process is not in the caller tenant', async () => {
    const { service, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue(null);
    await expect(service.initChecklist('p1', caller('analista'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
