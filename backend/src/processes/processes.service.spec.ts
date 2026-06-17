import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
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
  const dataSource = {
    query: jest.fn(),
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (m: unknown) => unknown) =>
        cb({ update: jest.fn(), query: jest.fn() }),
      ),
  };
  const webhook = { fireAndForget: jest.fn() };
  const email = { sendStageChange: jest.fn() };
  const documents = { initChecklist: jest.fn() };
  const service = new ProcessesService(
    repo as unknown as Repository<Process>,
    userRepo as unknown as Repository<User>,
    dataSource as unknown as DataSource,
    webhook as never,
    email as never,
    documents as never,
  );
  return { service, repo, userRepo, dataSource, webhook, email };
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
