import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService } from './audit.service';
import { RequestUserFull } from '../auth/supabase.guard';

function makeService() {
  const manager = { query: jest.fn() };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
  };
  const service = new AuditService(dataSource as unknown as DataSource);
  return { service, dataSource, manager };
}

const caller = { tenantId: 't1', userId: 'u1', role: 'dono' } as RequestUserFull;

describe('AuditService.undo (RN-07 reversible audit trail)', () => {
  it('404s when the log entry does not exist', async () => {
    const { service, dataSource } = makeService();
    dataSource.query.mockResolvedValueOnce([]); // no log row
    await expect(service.undo('log1', caller)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reverts a stage_change when the process is still on the logged target stage', async () => {
    const { service, dataSource, manager } = makeService();
    dataSource.query
      .mockResolvedValueOnce([
        { action: 'stage_change', process_id: 'p1', from_state: 'cadastro', to_state: 'analise_credito' },
      ])
      .mockResolvedValueOnce([{ stage: 'analise_credito' }]); // current stage matches to_state
    const res = await service.undo('log1', caller);
    expect(res).toEqual({ undone: true, action: 'stage_change', processId: 'p1' });
    expect(manager.query).toHaveBeenCalledTimes(2); // UPDATE + audit insert
  });

  it('refuses to revert a stage_change if the process moved on since (stale undo)', async () => {
    const { service, dataSource } = makeService();
    dataSource.query
      .mockResolvedValueOnce([
        { action: 'stage_change', process_id: 'p1', from_state: 'cadastro', to_state: 'analise_credito' },
      ])
      .mockResolvedValueOnce([{ stage: 'credito_aprovado' }]); // moved past the logged state
    await expect(service.undo('log1', caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reactivates a process when undoing a process_deactivated entry', async () => {
    const { service, dataSource } = makeService();
    dataSource.query
      .mockResolvedValueOnce([{ action: 'process_deactivated', process_id: 'p1' }])
      .mockResolvedValueOnce([{ active: false }]);
    const res = await service.undo('log1', caller);
    expect(res).toEqual({ undone: true, action: 'process_reactivated', processId: 'p1' });
  });

  it('refuses to reactivate a process that is already active', async () => {
    const { service, dataSource } = makeService();
    dataSource.query
      .mockResolvedValueOnce([{ action: 'process_deactivated', process_id: 'p1' }])
      .mockResolvedValueOnce([{ active: true }]);
    await expect(service.undo('log1', caller)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects undo for an action that is not reversible', async () => {
    const { service, dataSource } = makeService();
    dataSource.query.mockResolvedValueOnce([{ action: 'document_upload', process_id: 'p1' }]);
    await expect(service.undo('log1', caller)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AuditService.findAll (SEC-07 pagination clamp)', () => {
  it('clamps an oversized limit to 100 and a negative offset to 0', async () => {
    const { service, dataSource } = makeService();
    dataSource.query.mockResolvedValueOnce([]);
    await service.findAll(caller, 9999, -5);
    const params = (dataSource.query.mock.calls[0] as unknown[])[1];
    expect(params).toEqual(['t1', 100, 0]);
  });
});

describe('AuditService.findAll (BE-07 filters)', () => {
  const lastCall = (dataSource: { query: jest.Mock }) =>
    dataSource.query.mock.calls[0] as [string, unknown[]];

  it('without filters only scopes by tenant', async () => {
    const { service, dataSource } = makeService();
    dataSource.query.mockResolvedValueOnce([]);
    await service.findAll(caller, 20, 40);
    const [sql, params] = lastCall(dataSource);
    expect(sql).toMatch(/WHERE al\.tenant_id = \$1\s+ORDER BY/);
    expect(sql).toContain('LIMIT $2 OFFSET $3');
    expect(params).toEqual(['t1', 20, 40]);
  });

  it('narrows by process, action and inclusive period in Sao Paulo time', async () => {
    const { service, dataSource } = makeService();
    dataSource.query.mockResolvedValueOnce([]);
    await service.findAll(caller, 25, 0, {
      processId: 'p1',
      action: 'stage_change',
      from: '2026-10-01',
      to: '2026-10-07',
    });
    const [sql, params] = lastCall(dataSource);
    expect(sql).toContain('al.tenant_id = $1');
    expect(sql).toContain('al.process_id = $2');
    expect(sql).toContain('al.action = $3');
    expect(sql).toContain(
      "al.created_at >= ($4::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'",
    );
    expect(sql).toContain(
      "al.created_at < ($5::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'",
    );
    expect(sql).toContain('LIMIT $6 OFFSET $7');
    expect(params).toEqual([
      't1',
      'p1',
      'stage_change',
      '2026-10-01',
      '2026-10-07',
      25,
      0,
    ]);
  });

  it('accepts a single-day period (from = to)', async () => {
    const { service, dataSource } = makeService();
    dataSource.query.mockResolvedValueOnce([]);
    const day = '2026-10-07';
    await service.findAll(caller, 25, 0, { from: day, to: day });
    expect(lastCall(dataSource)[1]).toEqual(['t1', day, day, 25, 0]);
  });

  it('rejects a period whose start is after its end', async () => {
    const { service, dataSource } = makeService();
    await expect(
      service.findAll(caller, 25, 0, { from: '2026-10-08', to: '2026-10-07' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('returns total_count as a number on every row', async () => {
    const { service, dataSource } = makeService();
    dataSource.query.mockResolvedValueOnce([
      { id: 'a', total_count: '42' },
      { id: 'b', total_count: '42' },
    ]);
    const rows = await service.findAll(caller);
    expect(rows).toEqual([
      { id: 'a', total_count: 42 },
      { id: 'b', total_count: 42 },
    ]);
  });
});
