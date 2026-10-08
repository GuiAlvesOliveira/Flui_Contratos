import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DocumentTypesService } from './document-types.service';
import { DEFAULT_DOCUMENT_TYPES, DocumentType } from './document-type.entity';
import {
  CreateDocumentTypeDto,
  UpdateDocumentTypeDto,
} from './dto/document-type.dto';
import {
  RemoveDocumentQueryDto,
  RequestDocumentsDto,
} from './dto/request-documents.dto';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const execute = jest.fn();
  const qb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute,
  };
  const repo = {
    count: jest.fn().mockResolvedValue(5),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    createQueryBuilder: jest.fn(() => qb),
  };
  const service = new DocumentTypesService(
    repo as unknown as Repository<DocumentType>,
  );
  return { service, repo, qb };
}

const dono = { role: 'dono', tenantId: 't1', userId: 'u1' } as RequestUserFull;
const analista = {
  role: 'analista',
  tenantId: 't1',
  userId: 'u2',
} as RequestUserFull;

describe('DocumentTypesService (BE-03 Lista de Documentos)', () => {
  it('gives a tenant without catalog the default list on first read', async () => {
    const { service, repo, qb } = makeService();
    repo.count.mockResolvedValue(0);
    await service.list(dono);
    expect(repo.count).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
    expect(qb.values).toHaveBeenCalledWith(
      DEFAULT_DOCUMENT_TYPES.map((d) => ({ ...d, tenantId: 't1' })),
    );
    expect(qb.orIgnore).toHaveBeenCalled();
  });

  it('does not reseed a tenant that already has a catalog (even all inactive)', async () => {
    const { service, repo } = makeService();
    repo.count.mockResolvedValue(3);
    await service.list(dono);
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('lists active entries by category order, then label (numbers in order)', async () => {
    const { service, repo } = makeService();
    repo.find.mockResolvedValue([
      { label: 'Holerite (mês 10)', category: 'renda' },
      { label: 'Matrícula', category: 'imovel' },
      { label: 'Holerite (mês 2)', category: 'renda' },
      { label: 'RG ou CNH', category: 'pessoal' },
    ]);
    const rows = await service.list(analista, true);
    expect(repo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1', active: true }, // analista never sees inactive
    });
    expect(rows.map((r) => r.label)).toEqual([
      'RG ou CNH',
      'Holerite (mês 2)',
      'Holerite (mês 10)',
      'Matrícula',
    ]);
  });

  it('the gestor can list inactive entries too', async () => {
    const { service, repo } = makeService();
    await service.list(dono, true);
    expect(repo.find).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
  });

  it('creates an entry in the caller tenant', async () => {
    const { service, repo } = makeService();
    await service.create(
      { label: 'Matrícula do imóvel', category: 'imovel', description: '' },
      dono,
    );
    expect(repo.save).toHaveBeenCalledWith({
      tenantId: 't1',
      label: 'Matrícula do imóvel',
      category: 'imovel',
      description: null,
    });
  });

  it('answers 409 for a label that already exists in the tenant', async () => {
    const { service, repo } = makeService();
    repo.save.mockRejectedValue({ code: '23505' });
    await expect(
      service.create({ label: 'RG ou CNH', category: 'pessoal' }, dono),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('edits and deactivates an entry only inside the tenant', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue({
      id: 'ty1',
      tenantId: 't1',
      label: 'IPTU',
      category: 'outros',
      description: null,
      active: true,
    });
    await service.update(
      'ty1',
      { category: 'imovel', description: 'Carnê do ano', active: false },
      dono,
    );
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'ty1', tenantId: 't1' },
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'imovel',
        description: 'Carnê do ano',
        active: false,
      }),
    );
  });

  it('404s for an entry of another tenant', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.update('ty1', { active: false }, dono),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

async function errorsFor<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property).sort();
}

describe('BE-03 / BE-10 DTOs', () => {
  it('catalog entry: label 2–120 chars (trimmed), known category', async () => {
    expect(
      await errorsFor(CreateDocumentTypeDto, {
        label: '  Matrícula  ',
        category: 'imovel',
      }),
    ).toEqual([]);
    expect(
      await errorsFor(CreateDocumentTypeDto, { label: ' x ', category: 'foo' }),
    ).toEqual(['category', 'label']);
    expect(
      await errorsFor(UpdateDocumentTypeDto, { active: 'sim', tenantId: 't2' }),
    ).toEqual(['active', 'tenantId']);
  });

  it('request: 1–50 distinct UUIDs', async () => {
    const id = '3f8b0c5e-2a1d-4f6b-9c7e-1a2b3c4d5e6f';
    expect(
      await errorsFor(RequestDocumentsDto, { documentTypeIds: [id] }),
    ).toEqual([]);
    expect(
      await errorsFor(RequestDocumentsDto, { documentTypeIds: [] }),
    ).toEqual(['documentTypeIds']);
    expect(
      await errorsFor(RequestDocumentsDto, { documentTypeIds: [id, id] }),
    ).toEqual(['documentTypeIds']);
    expect(
      await errorsFor(RequestDocumentsDto, { documentTypeIds: ['RG'] }),
    ).toEqual(['documentTypeIds']);
  });

  it('removal: optional reason (≤300) and process id', async () => {
    expect(
      await errorsFor(RemoveDocumentQueryDto, { reason: 'Pedido do titular' }),
    ).toEqual([]);
    expect(
      await errorsFor(RemoveDocumentQueryDto, {
        reason: 'x'.repeat(301),
        processId: 'p1',
      }),
    ).toEqual(['processId', 'reason']);
  });
});
