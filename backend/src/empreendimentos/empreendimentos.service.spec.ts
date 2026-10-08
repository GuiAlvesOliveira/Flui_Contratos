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

  describe('FE-27: team', () => {
    const team = [
      { id: 'a1', name: 'Rafael', email: 'r@x.dev', role: 'analista' },
    ];

    it('lists the team inside the caller tenant only', async () => {
      const { service, repo, dataSource } = makeService();
      repo.findOne.mockResolvedValue({ id: 'e1', tenantId: 't1' });
      dataSource.query.mockResolvedValue(team);
      expect(await service.listTeam('e1', caller)).toEqual(team);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'e1', tenantId: 't1' },
      });
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('t.tenant_id = $2');
      expect(params).toEqual(['e1', 't1']);
    });

    it('404s for an empreendimento of another tenant without touching the team', async () => {
      const { service, repo, dataSource } = makeService();
      repo.findOne.mockResolvedValue(null);
      await expect(service.listTeam('e1', caller)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.addTeamMember('e1', 'a1', caller),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.removeTeamMember('e1', 'a1', caller),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('adds an analista of the same tenant (idempotent) and returns the team', async () => {
      const { service, repo, dataSource } = makeService();
      repo.findOne.mockResolvedValue({ id: 'e1', tenantId: 't1' });
      dataSource.query
        .mockResolvedValueOnce([
          { id: 'a1', role: 'analista', status: 'active' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(team);
      expect(await service.addTeamMember('e1', 'a1', caller)).toEqual(team);
      const calls = dataSource.query.mock.calls as [string, unknown[]][];
      expect(calls[0][1]).toEqual(['a1', 't1']); // user looked up in the tenant
      expect(calls[1][0]).toContain(
        'ON CONFLICT (empreendimento_id, user_id) DO NOTHING',
      );
      expect(calls[1][1]).toEqual(['t1', 'e1', 'a1', 'u1']);
    });

    it('refuses users outside the tenant, non-analistas and disabled accounts', async () => {
      const { service, repo, dataSource } = makeService();
      repo.findOne.mockResolvedValue({ id: 'e1', tenantId: 't1' });
      dataSource.query.mockResolvedValueOnce([]);
      await expect(
        service.addTeamMember('e1', 'x', caller),
      ).rejects.toBeInstanceOf(NotFoundException);
      dataSource.query.mockResolvedValueOnce([
        { id: 'c1', role: 'cliente', status: 'active' },
      ]);
      await expect(
        service.addTeamMember('e1', 'c1', caller),
      ).rejects.toBeInstanceOf(BadRequestException);
      dataSource.query.mockResolvedValueOnce([
        { id: 'a2', role: 'analista', status: 'disabled' },
      ]);
      await expect(
        service.addTeamMember('e1', 'a2', caller),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.query).toHaveBeenCalledTimes(3); // nothing inserted
    });

    it('removes a member scoped to the tenant', async () => {
      const { service, repo, dataSource } = makeService();
      repo.findOne.mockResolvedValue({ id: 'e1', tenantId: 't1' });
      dataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      expect(await service.removeTeamMember('e1', 'a1', caller)).toEqual([]);
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('DELETE FROM empreendimento_team');
      expect(params).toEqual(['e1', 'a1', 't1']);
    });
  });
});
