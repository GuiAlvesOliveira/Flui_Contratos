import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ProcessesService } from './processes.service';
import { Process } from './process.entity';
import { User } from '../users/user.entity';
import { AdvanceStageDto } from './dto/advance-stage.dto';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService(process: Partial<Process> | null) {
  const repo = { findOne: jest.fn().mockResolvedValue(process), save: jest.fn() };
  const userRepo = {
    findOne: jest.fn().mockResolvedValue({ email: 'c@x.com', name: 'Cli', telefone: null }),
  };
  const manager = { update: jest.fn(), query: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (m: unknown) => unknown) => cb(manager)),
  };
  const webhook = { fireAndForget: jest.fn() };
  const email = { sendStageChange: jest.fn() };
  const service = new ProcessesService(
    repo as unknown as Repository<Process>,
    userRepo as unknown as Repository<User>,
    dataSource as unknown as DataSource,
    webhook as never,
    email as never,
  );
  return { service, repo, userRepo, dataSource, manager, webhook, email };
}

const caller = { tenantId: 't1', userId: 'u1', role: 'analista' } as RequestUserFull;
const dto = (toStage: string) => ({ toStage } as AdvanceStageDto);

describe('ProcessesService.advanceStage', () => {
  it('BR-01: rejects a transition not allowed by the state machine', async () => {
    const { service, dataSource } = makeService({ id: 'p1', stage: 'inicial', mipValue: 1, dfiValue: 1 });
    await expect(service.advanceStage('p1', dto('cartorio'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('rejects a no-op move to the same stage', async () => {
    const { service } = makeService({ id: 'p1', stage: 'cadastro', mipValue: 1, dfiValue: 1 });
    await expect(service.advanceStage('p1', dto('cadastro'), caller)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('BR-02 (RN-05): blocks entry into cartorio without MIP/DFI', async () => {
    const { service } = makeService({ id: 'p1', stage: 'juridico_aprovado', mipValue: null, dfiValue: null });
    await expect(service.advanceStage('p1', dto('cartorio'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('RN-04 fail-closed: blocks advance when the checklist is uninitialised (total=0)', async () => {
    const { service, dataSource } = makeService({ id: 'p1', stage: 'analise_credito', mipValue: 1, dfiValue: 1 });
    dataSource.query.mockResolvedValueOnce([{ total: '0', pending: '0' }]);
    await expect(service.advanceStage('p1', dto('credito_aprovado'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('RN-04: blocks advance when documents are still pending', async () => {
    const { service, dataSource } = makeService({ id: 'p1', stage: 'analise_credito', mipValue: 1, dfiValue: 1 });
    dataSource.query
      .mockResolvedValueOnce([{ total: '3', pending: '2' }])
      .mockResolvedValueOnce([{ label: 'RG', status: 'pendente' }]);
    await expect(service.advanceStage('p1', dto('credito_aprovado'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('RN-04: the gate also counts the client personal docs (process_id NULL)', async () => {
    const { service, dataSource } = makeService({
      id: 'p1', stage: 'analise_credito', clientId: 'c1', mipValue: 1, dfiValue: 1,
    });
    dataSource.query
      .mockResolvedValueOnce([{ total: '4', pending: '1' }])
      .mockResolvedValueOnce([{ label: 'RG ou CNH', status: 'recebido' }]);
    await expect(service.advanceStage('p1', dto('credito_aprovado'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('process_id IS NULL AND user_id = $3');
    expect(params).toEqual(['p1', 't1', 'c1']);
  });

  it('records the stage a process is parked from when it goes on hold', async () => {
    const { service, manager } = makeService({
      id: 'p1', stage: 'analise_juridica', clientId: 'c1', mipValue: null, dfiValue: null,
    });
    await service.advanceStage('p1', dto('processo_pendencia'), caller);
    expect(manager.update).toHaveBeenCalledWith(Process, 'p1', {
      stage: 'processo_pendencia',
      stageBeforePendencia: 'analise_juridica',
    });
  });

  it('BR-01/RN-04: a hold cannot be used to jump past the stage it was parked from', async () => {
    const { service, dataSource } = makeService({
      id: 'p1', stage: 'processo_pendencia', stageBeforePendencia: 'cadastro', mipValue: 1, dfiValue: 1,
    });
    await expect(service.advanceStage('p1', dto('juridico_aprovado'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('resumes a hold at the stage it was parked from', async () => {
    const { service } = makeService({
      id: 'p1', stage: 'processo_pendencia', stageBeforePendencia: 'cadastro', clientId: 'c1',
      mipValue: null, dfiValue: null,
    });
    await expect(service.advanceStage('p1', dto('cadastro'), caller)).resolves.toEqual({
      id: 'p1', fromStage: 'processo_pendencia', toStage: 'cadastro',
    });
  });

  it('RN-04: resuming a hold beyond analise_credito still requires validated docs', async () => {
    const { service, dataSource } = makeService({
      id: 'p1', stage: 'processo_pendencia', stageBeforePendencia: 'cartorio', clientId: 'c1',
      mipValue: 1, dfiValue: 1,
    });
    dataSource.query
      .mockResolvedValueOnce([{ total: '4', pending: '1' }])
      .mockResolvedValueOnce([{ label: 'Holerite (mês 1)', status: 'rejeitado' }]);
    await expect(service.advanceStage('p1', dto('cartorio'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('RN-04: a legacy hold (no recorded stage) is gated when resuming ahead', async () => {
    const { service, dataSource } = makeService({
      id: 'p1', stage: 'processo_pendencia', stageBeforePendencia: null, clientId: 'c1',
      mipValue: 1, dfiValue: 1,
    });
    dataSource.query.mockResolvedValueOnce([{ total: '0', pending: '3' }]);
    await expect(service.advanceStage('p1', dto('juridico_aprovado'), caller)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    // Blocked by the document gate, not by the transition check.
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it('advances on a valid move and fires the n8n webhook', async () => {
    const { service, webhook } = makeService({
      id: 'p1',
      stage: 'inicial',
      clientId: 'c1',
      mipValue: null,
      dfiValue: null,
    });
    const res = await service.advanceStage('p1', dto('cadastro'), caller);
    expect(res).toEqual({ id: 'p1', fromStage: 'inicial', toStage: 'cadastro' });
    expect(webhook.fireAndForget).toHaveBeenCalledTimes(1);
  });
});

describe('ProcessesService.getIncomeComposition (RN-06)', () => {
  it('sums every participant declared income from the database', async () => {
    const { service, dataSource } = makeService({ id: 'p1', tenantId: 't1' });
    dataSource.query.mockResolvedValueOnce([{ total: '7500.50', count: '3' }]);
    await expect(service.getIncomeComposition('p1', caller)).resolves.toEqual({
      composedIncome: 7500.5,
      participantCount: 3,
    });
  });

  it('returns zero composition when the process has no participants', async () => {
    const { service, dataSource } = makeService({ id: 'p1', tenantId: 't1' });
    dataSource.query.mockResolvedValueOnce([{ total: '0', count: '0' }]);
    await expect(service.getIncomeComposition('p1', caller)).resolves.toEqual({
      composedIncome: 0,
      participantCount: 0,
    });
  });

  it('scopes a cliente caller to their own process (RN-01)', async () => {
    const { service, repo, dataSource } = makeService({ id: 'p1', tenantId: 't1' });
    dataSource.query.mockResolvedValueOnce([{ total: '0', count: '0' }]);
    const cliente = { tenantId: 't1', userId: 'c1', role: 'cliente' } as RequestUserFull;
    await service.getIncomeComposition('p1', cliente);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { id: 'p1', tenantId: 't1', clientId: 'c1' },
    });
  });

  it('404s when the process is absent from the caller tenant', async () => {
    const { service } = makeService(null);
    await expect(service.getIncomeComposition('p1', caller)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ProcessesService.exportCsv (BE-17)', () => {
  const dono = {
    tenantId: 't1',
    userId: 'g1',
    role: 'dono',
  } as RequestUserFull;

  it('exports the active processes of the tenant and logs the export', async () => {
    const { service, dataSource } = makeService(null);
    dataSource.query
      .mockResolvedValueOnce([
        {
          id: 'abcd0000-0000-4000-8000-000000000001',
          stage: 'cadastro',
          created_at: '2026-10-01T12:00:00Z',
          client_name: 'Ana',
          client_surname: 'Souza',
          client_email: 'ana@x.dev',
          analista_name: null,
          empreendimento: null,
          unidade: null,
          valor_unidade: null,
        },
      ])
      .mockResolvedValueOnce([]);
    const csv = await service.exportCsv(dono);
    expect(csv.split('\r\n')[1]).toBe(
      'CLI-ABCD;Ana Souza;Cadastro;01/10/2026;;;;',
    );
    const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('p.tenant_id = $1 AND p.active = true');
    expect(params).toEqual(['t1']);
    const [logSql, logParams] = dataSource.query.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(logSql).toContain("'processes_exported'");
    expect(logParams).toEqual(['t1', 'g1', JSON.stringify({ count: 1 })]);
  });
});
