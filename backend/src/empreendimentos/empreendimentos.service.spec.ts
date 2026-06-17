import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { EmpreendimentosService } from './empreendimentos.service';
import { Empreendimento } from './empreendimento.entity';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
  };
  const dataSource = { query: jest.fn() };
  const service = new EmpreendimentosService(
    repo as unknown as Repository<Empreendimento>,
    dataSource as unknown as DataSource,
  );
  return { service, repo, dataSource };
}

const caller = { role: 'dono', tenantId: 't1', userId: 'u1' } as RequestUserFull;

describe('EmpreendimentosService', () => {
  it('creates an empreendimento scoped to the caller tenant', async () => {
    const { service, repo } = makeService();
    await service.create({ nome: 'Ed. A', matriculaMae: '123', endereco: 'R. X', cep: '01000-000', bancoFinanciador: 'Caixa' }, caller);
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', nome: 'Ed. A' }));
  });

  it('404s on findOne when the empreendimento is outside the tenant', async () => {
    const { service, repo } = makeService();
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne('e1', caller)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks removal while there are active processes under it', async () => {
    const { service, repo, dataSource } = makeService();
    repo.findOne.mockResolvedValue({ id: 'e1', tenantId: 't1', active: true });
    dataSource.query.mockResolvedValue([{ count: '2' }]);
    await expect(service.remove('e1', caller)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('soft-deletes (active=false) when no active process blocks it', async () => {
    const { service, repo, dataSource } = makeService();
    repo.findOne.mockResolvedValue({ id: 'e1', tenantId: 't1', active: true });
    dataSource.query.mockResolvedValue([{ count: '0' }]);
    const res = await service.remove('e1', caller);
    expect(res).toEqual({ id: 'e1', deleted: true });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });
});
