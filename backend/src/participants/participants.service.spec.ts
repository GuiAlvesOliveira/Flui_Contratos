import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ParticipantsService } from './participants.service';
import { ProcessParticipant } from './participant.entity';
import { Process } from '../processes/process.entity';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const repo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((x: unknown) => x),
    save: jest.fn((x: unknown) => Promise.resolve(x)),
    remove: jest.fn((x: unknown) => Promise.resolve(x)),
  };
  const processRepo = { findOne: jest.fn() };
  const service = new ParticipantsService(
    repo as unknown as Repository<ProcessParticipant>,
    processRepo as unknown as Repository<Process>,
  );
  return { service, repo, processRepo };
}

const analista = { role: 'analista', tenantId: 't1', userId: 'a1' } as RequestUserFull;
const cliente = (userId: string) => ({ role: 'cliente', tenantId: 't1', userId } as RequestUserFull);

describe('ParticipantsService — tenant/owner isolation (RN-01)', () => {
  it('404s when the parent process is not in the caller tenant', async () => {
    const { service, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue(null);
    await expect(service.findAll('p1', analista)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids a cliente from reading participants of another client process', async () => {
    const { service, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', tenantId: 't1', clientId: 'owner' });
    await expect(service.findAll('p1', cliente('intruder'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lists participants of the caller own process', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', tenantId: 't1', clientId: 'c1' });
    repo.find.mockResolvedValue([{ id: 'part1' }]);
    await expect(service.findAll('p1', cliente('c1'))).resolves.toEqual([{ id: 'part1' }]);
  });

  it('creates a participant scoped to the process tenant', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', tenantId: 't1', clientId: 'c1' });
    await service.create('p1', { name: 'Maria', declaredIncome: 3000 }, analista);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 'p1', tenantId: 't1', name: 'Maria', declaredIncome: 3000 }),
    );
  });

  it('404s when removing a participant that does not exist', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', tenantId: 't1', clientId: 'c1' });
    repo.findOne.mockResolvedValue(null);
    await expect(service.remove('p1', 'missing', analista)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('removes an existing participant and returns its id', async () => {
    const { service, repo, processRepo } = makeService();
    processRepo.findOne.mockResolvedValue({ id: 'p1', tenantId: 't1', clientId: 'c1' });
    repo.findOne.mockResolvedValue({ id: 'part1', processId: 'p1', tenantId: 't1' });
    await expect(service.remove('p1', 'part1', analista)).resolves.toEqual({ id: 'part1' });
    expect(repo.remove).toHaveBeenCalled();
  });
});
