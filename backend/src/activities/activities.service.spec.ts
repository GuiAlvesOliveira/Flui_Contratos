import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { RequestUserFull } from '../auth/supabase.guard';
import {
  ActivitiesService,
  type StaffActivityView,
} from './activities.service';

const TENANT = 't1';
const user = (role: RequestUserFull['role'], userId: string, name = 'Fulano') =>
  ({ role, userId, tenantId: TENANT, name }) as RequestUserFull;

const analista = user('analista', 'an1', 'Rafaela'); // responsável pelo processo
const outroAnalista = user('analista', 'an2', 'Marcos');
const gestor = user('dono', 'g1', 'Gestora');
const cliente = user('cliente', 'c1', 'Helena');
const outroCliente = user('cliente', 'c2', 'Pedro');

const HOUR = 60 * 60 * 1000;
const activity = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1',
  stage: 'cadastro',
  description: 'Liguei para o cliente cobrando o holerite',
  created_at: new Date(Date.now() - HOUR),
  edited_at: null,
  author_id: 'an1',
  author_name: 'Rafaela',
  ...over,
});

function makeService(
  opts: {
    process?: Record<string, unknown> | null;
    activities?: Record<string, unknown>[];
  } = {},
) {
  const process =
    opts.process === null
      ? null
      : {
          id: 'p1',
          client_id: 'c1',
          analista_id: 'an1',
          active: true,
          ...opts.process,
        };
  const rows = opts.activities ?? [activity()];
  const manager = { query: jest.fn().mockResolvedValue([]) };
  const dataSource = {
    query: jest.fn((sql: string, params: unknown[]) => {
      if (sql.includes('FROM processes WHERE id')) {
        // the tenant is part of the lookup (RN-01)
        return Promise.resolve(
          process && params[1] === TENANT ? [process] : [],
        );
      }
      if (sql.includes('INSERT INTO process_activities')) {
        return Promise.resolve([
          activity({
            id: 'new',
            description: params[3],
            stage: 'analise_credito',
            created_at: new Date(),
          }),
        ]);
      }
      if (sql.includes('WHERE a.id = $1')) {
        return Promise.resolve(rows.filter((r) => r.id === params[0]));
      }
      if (sql.includes('FROM process_activities a'))
        return Promise.resolve(rows);
      return Promise.resolve([]);
    }),
    transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
  };
  const service = new ActivitiesService(dataSource as unknown as DataSource);
  return { service, dataSource, manager };
}

const sqlCalls = (ds: { query: jest.Mock }, needle: string) =>
  ds.query.mock.calls.filter(([sql]) => String(sql).includes(needle)) as [
    string,
    unknown[],
  ][];

describe('ActivitiesService.create', () => {
  it('the responsible analista registers; stage and time come from the database', async () => {
    const { service, dataSource } = makeService();
    const res = await service.create(
      'p1',
      'Enviei mensagem cobrando os documentos',
      analista,
    );
    const [[sql, params]] = sqlCalls(
      dataSource,
      'INSERT INTO process_activities',
    );
    // stage = the process stage read in the same statement; created_at = DEFAULT now()
    expect(sql).toContain(
      'SELECT p.tenant_id, p.id, p.client_id, $3, p.stage, $4',
    );
    const insertedColumns = sql.slice(sql.indexOf('('), sql.indexOf(')'));
    expect(insertedColumns).not.toContain('created_at');
    expect(params).toEqual([
      'p1',
      TENANT,
      'an1',
      'Enviei mensagem cobrando os documentos',
    ]);
    expect(res).toMatchObject({
      id: 'new',
      stage: 'analise_credito',
      description: 'Enviei mensagem cobrando os documentos',
      author: { id: 'an1', name: 'Rafaela' },
      canEdit: true,
      canDelete: true,
    });
  });

  it.each([
    ['another analista of the assessoria', outroAnalista],
    ['the gestor', gestor],
  ])('%s cannot register', async (_who, caller) => {
    const { service, dataSource } = makeService();
    await expect(
      service.create('p1', 'Texto válido', caller),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sqlCalls(dataSource, 'INSERT')).toHaveLength(0);
  });

  it('a process without a responsible analista takes no entries', async () => {
    const { service } = makeService({ process: { analista_id: null } });
    await expect(
      service.create('p1', 'Texto válido', analista),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a removed (deactivated) process takes no entries', async () => {
    const { service } = makeService({ process: { active: false } });
    await expect(
      service.create('p1', 'Texto válido', analista),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('RN-01: a process of another assessoria is not found', async () => {
    const { service } = makeService();
    const intruso = { ...analista, tenantId: 't2' } as RequestUserFull;
    await expect(
      service.create('p1', 'Texto válido', intruso),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ActivitiesService.list', () => {
  const rows = [
    activity({
      id: 'a2',
      description: 'mais recente',
      created_at: new Date(Date.now() - HOUR),
    }),
    activity({
      id: 'a1',
      description: 'antiga',
      created_at: new Date(Date.now() - 30 * HOUR),
      author_id: 'an9',
      author_name: 'Ex-analista',
    }),
  ];

  it('newest first, without removed entries, scoped by tenant', async () => {
    const { service, dataSource } = makeService({ activities: rows });
    await service.list('p1', gestor);
    const [[sql, params]] = sqlCalls(dataSource, 'FROM process_activities a');
    expect(sql).toContain('a.deleted_at IS NULL');
    expect(sql).toContain('ORDER BY a.created_at DESC');
    expect(params).toEqual(['p1', TENANT]);
  });

  it('the client reads only date/time, stage and description', async () => {
    const { service } = makeService({ activities: rows });
    const res = await service.list('p1', cliente);
    expect(res.canCreate).toBe(false);
    expect(res.activities).toHaveLength(2);
    for (const a of res.activities) {
      expect(Object.keys(a).sort()).toEqual([
        'createdAt',
        'description',
        'id',
        'stage',
      ]);
    }
  });

  it("a client cannot read another client's process (404)", async () => {
    const { service } = makeService({ activities: rows });
    await expect(service.list('p1', outroCliente)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('staff see the author; only the author edits, within 24 h', async () => {
    const { service } = makeService({ activities: rows });
    const res = await service.list('p1', analista);
    expect(res.canCreate).toBe(true);
    const [recent, old] = res.activities as StaffActivityView[];
    expect(recent).toMatchObject({
      author: { name: 'Rafaela' },
      canEdit: true,
      canDelete: true,
    });
    expect(old).toMatchObject({
      author: { name: 'Ex-analista' },
      canEdit: false,
      canDelete: false,
    });
  });

  it('the gestor reads everything and may remove any entry, but never edits nor creates', async () => {
    const { service } = makeService({ activities: rows });
    const res = await service.list('p1', gestor);
    expect(res.canCreate).toBe(false);
    for (const a of res.activities as StaffActivityView[]) {
      expect(a).toMatchObject({ canEdit: false, canDelete: true });
    }
  });

  it('another analista of the assessoria reads but cannot create', async () => {
    const { service } = makeService({ activities: rows });
    const res = await service.list('p1', outroAnalista);
    expect(res.canCreate).toBe(false);
    expect(res.activities).toHaveLength(2);
  });
});

describe('ActivitiesService.update', () => {
  it('the author fixes the description within 24 h; the previous text goes to the audit log', async () => {
    const { service, manager } = makeService();
    await service.update(
      'p1',
      'a1',
      'Liguei e cobrei o holerite de setembro',
      analista,
    );
    const [[upd, updParams], [audit, auditParams]] = manager.query.mock
      .calls as [string, unknown[]][];
    expect(upd).toContain('SET description = $1, edited_at = now()');
    expect(upd).not.toContain('stage'); // stage, date and author never change
    expect(updParams).toEqual([
      'Liguei e cobrei o holerite de setembro',
      'a1',
      TENANT,
    ]);
    expect(audit).toContain('INSERT INTO audit_logs');
    expect(auditParams[3]).toBe('activity_edited');
    expect(JSON.parse(auditParams[4] as string)).toMatchObject({
      activityId: 'a1',
      before: 'Liguei para o cliente cobrando o holerite',
    });
  });

  it('after 24 h it can no longer be edited', async () => {
    const { service, manager } = makeService({
      activities: [activity({ created_at: new Date(Date.now() - 25 * HOUR) })],
    });
    await expect(
      service.update('p1', 'a1', 'Texto novo', analista),
    ).rejects.toThrow(/prazo de 24 horas/);
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('nobody but the author edits', async () => {
    const { service } = makeService();
    await expect(
      service.update('p1', 'a1', 'Texto novo', outroAnalista),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a removed entry is not found', async () => {
    const { service } = makeService({ activities: [] });
    await expect(
      service.update('p1', 'a1', 'Texto novo', analista),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ActivitiesService.remove', () => {
  it('the author withdraws within 24 h: soft delete + audit log with the text', async () => {
    const { service, manager } = makeService();
    await expect(
      service.remove('p1', 'a1', undefined, analista),
    ).resolves.toEqual({
      id: 'a1',
      deleted: true,
    });
    const [[upd, updParams], [, auditParams]] = manager.query.mock.calls as [
      string,
      unknown[],
    ][];
    expect(upd).toContain(
      'SET deleted_at = now(), deleted_by = $1, delete_reason = $2',
    );
    expect(upd).not.toContain('DELETE');
    expect(updParams).toEqual(['an1', null, 'a1', TENANT]);
    expect(auditParams[3]).toBe('activity_deleted');
    expect(JSON.parse(auditParams[4] as string)).toMatchObject({
      activityId: 'a1',
      description: 'Liguei para o cliente cobrando o holerite',
    });
  });

  it('the gestor removes at any time, but must give a reason', async () => {
    const old = [activity({ created_at: new Date(Date.now() - 300 * HOUR) })];
    const { service, manager } = makeService({ activities: old });
    await expect(
      service.remove('p1', 'a1', undefined, gestor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.remove(
      'p1',
      'a1',
      'Informação errada para o cliente',
      gestor,
    );
    const [, updParams] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(updParams).toEqual([
      'g1',
      'Informação errada para o cliente',
      'a1',
      TENANT,
    ]);
  });

  it('the author cannot remove after 24 h; another analista never', async () => {
    const old = [activity({ created_at: new Date(Date.now() - 25 * HOUR) })];
    await expect(
      makeService({ activities: old }).service.remove(
        'p1',
        'a1',
        undefined,
        analista,
      ),
    ).rejects.toThrow(/prazo de 24 horas/);
    await expect(
      makeService().service.remove('p1', 'a1', undefined, outroAnalista),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
