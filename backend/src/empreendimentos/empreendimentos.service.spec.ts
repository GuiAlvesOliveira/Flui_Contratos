import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import {
  EmpreendimentosService,
  empreendimentoStatus,
} from './empreendimentos.service';
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

  it('lists the tenant empreendimentos with process counts and derived status', async () => {
    const { service, repo, dataSource } = makeService();
    repo.find.mockResolvedValue([
      { id: 'e1', nome: 'Ed. A', matriculaMae: '111' },
      { id: 'e2', nome: 'Ed. B', matriculaMae: '222' },
      { id: 'e3', nome: 'Ed. C', matriculaMae: '333' },
    ]);
    dataSource.query.mockResolvedValue([
      {
        empreendimento_id: 'e1',
        total: '3',
        em_andamento: '2',
        concluidos: '1',
      },
      {
        empreendimento_id: 'e2',
        total: '2',
        em_andamento: '0',
        concluidos: '2',
      },
    ]);

    const res = await service.findAll(caller);

    expect(repo.find).toHaveBeenCalledWith({
      where: { tenantId: 't1', active: true },
    });
    const [sql, params] = dataSource.query.mock.calls[0] as [string, string[]];
    expect(sql).toContain('p.tenant_id = $1');
    expect(sql).not.toContain('analista_id');
    expect(params).toEqual(['t1']);
    expect(res).toEqual([
      expect.objectContaining({
        id: 'e1',
        matriculaMae: '111',
        processCount: 3,
        processosEmAndamento: 2,
        processosConcluidos: 1,
        status: 'em_andamento',
      }),
      expect.objectContaining({
        id: 'e2',
        processCount: 2,
        processosEmAndamento: 0,
        processosConcluidos: 2,
        status: 'concluido',
      }),
      expect.objectContaining({
        id: 'e3',
        processCount: 0,
        processosEmAndamento: 0,
        processosConcluidos: 0,
        status: 'sem_processos',
      }),
    ]);
  });

  it('counts only the analista own processes, like GET /processes', async () => {
    const { service, repo, dataSource } = makeService();
    repo.find.mockResolvedValue([{ id: 'e1' }]);
    dataSource.query.mockResolvedValue([]);
    const analista = {
      role: 'analista',
      tenantId: 't1',
      userId: 'an1',
    } as RequestUserFull;

    await service.findAll(analista);

    const [sql, params] = dataSource.query.mock.calls[0] as [string, string[]];
    expect(sql).toContain('p.analista_id = $2');
    expect(params).toEqual(['t1', 'an1']);
  });

  it('skips the count query when the tenant has no empreendimento', async () => {
    const { service, repo, dataSource } = makeService();
    repo.find.mockResolvedValue([]);
    await expect(service.findAll(caller)).resolves.toEqual([]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('derives the status from in-progress and signed process counts', () => {
    expect(empreendimentoStatus(1, 0)).toBe('em_andamento');
    expect(empreendimentoStatus(2, 5)).toBe('em_andamento');
    expect(empreendimentoStatus(0, 1)).toBe('concluido');
    expect(empreendimentoStatus(0, 0)).toBe('sem_processos');
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
