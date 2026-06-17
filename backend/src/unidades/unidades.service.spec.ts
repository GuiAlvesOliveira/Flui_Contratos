import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UnidadesService } from './unidades.service';
import { Unidade } from './unidade.entity';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  const dataSource = { query: jest.fn() };
  const service = new UnidadesService(
    repo as unknown as Repository<Unidade>,
    dataSource as unknown as DataSource,
  );
  return { service, repo, dataSource };
}

const caller = { role: 'dono', tenantId: 't1', userId: 'u1' } as RequestUserFull;

describe('UnidadesService', () => {
  it('creates a unidade scoped to the caller tenant', async () => {
    const { service, repo } = makeService();
    await service.create({ empreendimentoId: 'e1', identificacao: 'Apto 101', valor: 250000 }, caller);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', empreendimentoId: 'e1', identificacao: 'Apto 101' }),
    );
  });

  it('404s on findOne when the unidade is outside the tenant', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('un1', caller)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks removal while an active process references the unidade', async () => {
    const { service, repo, dataSource } = makeService();
    repo.findOne.mockResolvedValue({ id: 'un1', tenantId: 't1' });
    dataSource.query.mockResolvedValue([{ count: '1' }]);
    await expect(service.remove('un1', caller)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes the unidade when no active process references it', async () => {
    const { service, repo, dataSource } = makeService();
    repo.findOne.mockResolvedValue({ id: 'un1', tenantId: 't1' });
    dataSource.query.mockResolvedValue([{ count: '0' }]);
    const res = await service.remove('un1', caller);
    expect(res).toEqual({ id: 'un1', deleted: true });
    expect(repo.delete).toHaveBeenCalledWith('un1');
  });
});
