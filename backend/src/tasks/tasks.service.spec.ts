import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { RequestUserFull } from '../auth/supabase.guard';
import { TasksService } from './tasks.service';

const gestor = {
  tenantId: 't1',
  userId: 'g1',
  role: 'dono',
} as RequestUserFull;
const ana = {
  tenantId: 't1',
  userId: 'a1',
  role: 'analista',
} as RequestUserFull;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  title: 'Cobrar holerite',
  description: null,
  due_date: '2026-10-17',
  status: 'a_fazer',
  process_id: 'p1',
  client_name: 'Carla Cliente',
  client_email: 'carla@x.dev',
  process_stage: 'cadastro',
  assignee_id: 'a1',
  assignee_name: 'Ana',
  assignee_email: 'ana@x.dev',
  created_by: 'g1',
  creator_name: 'Gestora',
  created_at: new Date('2026-10-15T12:00:00Z'),
  updated_at: new Date('2026-10-15T12:00:00Z'),
  completed_at: null,
  overdue: true,
  days_late: '2',
  ...over,
});

type Handler = (sql: string, params: unknown[]) => unknown;

function setup(handlers: [RegExp, Handler][] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const h = handlers.find(([re]) => re.test(sql));
    return Promise.resolve(h ? h[1](sql, params) : []);
  });
  const service = new TasksService({ query } as unknown as DataSource);
  const find = (re: RegExp) => calls.filter((c) => re.test(c.sql));
  return { service, calls, find };
}

const COUNTS = [
  {
    total: '3',
    atrasadas: '1',
    hoje: '1',
    semana: '2',
    a_fazer: '2',
    em_andamento: '0',
    concluida: '1',
  },
];

describe('TasksService.list (PROD-01)', () => {
  it('filtra pela assessoria de quem chama e devolve contagens numéricas', async () => {
    const { service, calls } = setup([
      [/COUNT\(\*\) AS total/, () => COUNTS],
      [/FROM tasks t\s+JOIN users a/, () => [row()]],
    ]);
    const r = await service.list(gestor, {});
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.sql).toContain('t.tenant_id = $1');
      expect(c.sql).toContain('t.deleted_at IS NULL');
      expect(c.params[0]).toBe('t1');
    }
    expect(r.counts).toEqual({
      total: 3,
      atrasadas: 1,
      hoje: 1,
      semana: 2,
      a_fazer: 2,
      em_andamento: 0,
      concluida: 1,
    });
    expect(r.tasks[0]).toMatchObject({
      id: 'k1',
      dueDate: '2026-10-17',
      overdue: true,
      daysLate: 2,
      process: { id: 'p1', clientName: 'Carla Cliente', stage: 'cadastro' },
      assignee: { id: 'a1', name: 'Ana' },
      canEdit: true,
      canReassign: true,
      canDelete: true,
    });
  });

  it('o analista só vê as tarefas dele ou criadas por ele', async () => {
    const { service, calls } = setup([[/COUNT/, () => COUNTS]]);
    await service.list(ana, {});
    for (const c of calls) {
      expect(c.sql).toContain('(t.assignee_id = $2 OR t.created_by = $2)');
      expect(c.params).toEqual(['t1', 'a1']);
    }
  });

  it('status e prazo filtram a lista mas não as contagens', async () => {
    const { service, calls } = setup([[/COUNT/, () => COUNTS]]);
    await service.list(gestor, {
      status: 'a_fazer',
      due: 'atrasadas',
      assigneeId: 'a1',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const [countSql, listSql] = calls.map((c) => c.sql);
    expect(countSql).not.toContain('t.status = $');
    expect(countSql).toContain('t.assignee_id = $2');
    expect(countSql).toContain('t.due_date >= $3::date');
    expect(countSql).toContain('t.due_date <= $4::date');
    expect(listSql).toContain('t.status = $5');
    expect(listSql).toMatch(
      /t\.status <> 'concluida' AND t\.due_date < \(now\(\) AT TIME ZONE 'America\/Sao_Paulo'\)::date/,
    );
    expect(calls[1].params).toEqual([
      't1',
      'a1',
      '2026-10-01',
      '2026-10-31',
      'a_fazer',
    ]);
  });

  it.each([
    ['hoje', /t\.due_date = \(now\(\)/],
    ['semana', /BETWEEN \(now\(\).*\+ 6/],
  ] as const)('prazo "%s"', async (due, re) => {
    const { service, calls } = setup([[/COUNT/, () => COUNTS]]);
    await service.list(gestor, { due });
    expect(calls[1].sql).toMatch(re);
  });

  it('o analista não reatribui nem exclui o que não criou (flags da tela)', async () => {
    const { service } = setup([
      [/COUNT/, () => COUNTS],
      [/FROM tasks t\s+JOIN users a/, () => [row()]],
    ]);
    const r = await service.list(ana, {});
    expect(r.tasks[0]).toMatchObject({
      canEdit: true,
      canReassign: false,
      canDelete: false,
    });
  });
});

describe('TasksService.create (PROD-01)', () => {
  const insert = /INSERT INTO tasks/;
  const byId = /WHERE t\.id = \$1/;

  it('o analista cria para si e só liga processos em que é o analista', async () => {
    const { service, find } = setup([
      [/FROM processes/, () => [{ id: 'p1' }]],
      [insert, () => [{ id: 'k9' }]],
      [byId, () => [row({ id: 'k9', created_by: 'a1' })]],
    ]);
    const t = await service.create(
      { title: 'Agendar vistoria', dueDate: '2026-10-20', processId: 'p1' },
      ana,
    );
    expect(find(/FROM processes/)[0].sql).toContain('AND analista_id = $3');
    expect(find(/FROM processes/)[0].params).toEqual(['p1', 't1', 'a1']);
    expect(find(insert)[0].params).toEqual([
      't1',
      'p1',
      'Agendar vistoria',
      null,
      'a1',
      '2026-10-20',
      'a1',
    ]);
    expect(t.canDelete).toBe(true);
  });

  it('processo de outra assessoria (ou de outro analista) → 404 e nada é gravado', async () => {
    const { service, find } = setup([[/FROM processes/, () => []]]);
    await expect(
      service.create(
        { title: 'Tarefa', dueDate: '2026-10-20', processId: 'px' },
        ana,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(find(insert)).toHaveLength(0);
  });

  it('o analista não atribui a outra pessoa (403)', async () => {
    const { service, find } = setup();
    await expect(
      service.create(
        { title: 'Tarefa', dueDate: '2026-10-20', assigneeId: 'a2' },
        ana,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(find(insert)).toHaveLength(0);
  });

  it('o gestor atribui a alguém ativo da equipe da própria assessoria', async () => {
    const { service, find } = setup([
      [/FROM users\s+WHERE id = \$1/, () => [{ id: 'a2' }]],
      [insert, () => [{ id: 'k9' }]],
      [byId, () => [row({ id: 'k9', assignee_id: 'a2' })]],
    ]);
    await service.create(
      { title: 'Tarefa', dueDate: '2026-10-20', assigneeId: 'a2' },
      gestor,
    );
    const check = find(/FROM users\s+WHERE id = \$1/)[0];
    expect(check.sql).toContain("role IN ('dono', 'analista')");
    expect(check.sql).toContain("status <> 'disabled'");
    expect(check.params).toEqual(['a2', 't1']);
    expect(find(insert)[0].params[4]).toBe('a2');
  });

  it('responsável fora da assessoria, cliente ou desativado → 404', async () => {
    const { service, find } = setup([
      [/FROM users\s+WHERE id = \$1/, () => []],
    ]);
    await expect(
      service.create(
        { title: 'Tarefa', dueDate: '2026-10-20', assigneeId: 'zz' },
        gestor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(find(insert)).toHaveLength(0);
  });
});

describe('TasksService.update / remove (PROD-01)', () => {
  const byId = /WHERE t\.id = \$1/;
  const upd = /UPDATE tasks SET/;

  it('tarefa de outra assessoria ou alheia ao analista → 404', async () => {
    const none = setup([[byId, () => []]]);
    await expect(
      none.service.update('k1', { title: 'Novo' }, gestor),
    ).rejects.toBeInstanceOf(NotFoundException);
    const other = setup([
      [byId, () => [row({ assignee_id: 'a2', created_by: 'g1' })]],
    ]);
    await expect(
      other.service.update('k1', { title: 'Novo' }, ana),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(other.find(upd)).toHaveLength(0);
    // a busca é sempre limitada à assessoria de quem chama
    expect(none.find(byId)[0].params).toEqual(['k1', 't1']);
  });

  it('concluir grava completed_at/completed_by; reabrir limpa', async () => {
    const { service, find } = setup([[byId, () => [row()]]]);
    await service.update('k1', { status: 'concluida' }, ana);
    expect(find(upd)[0].sql).toContain('completed_at = now()');
    expect(find(upd)[0].params).toEqual(['concluida', 'a1', 'k1', 't1']);

    const again = setup([[byId, () => [row({ status: 'concluida' })]]]);
    await again.service.update('k1', { status: 'a_fazer' }, ana);
    expect(again.find(upd)[0].sql).toContain(
      'completed_at = NULL, completed_by = NULL',
    );
  });

  it('só o gestor reatribui; sem mudança real não grava nada', async () => {
    const a = setup([[byId, () => [row()]]]);
    await expect(
      a.service.update('k1', { assigneeId: 'a2' }, ana),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await a.service.update(
      'k1',
      { assigneeId: 'a1', status: 'a_fazer', processId: 'p1' },
      ana,
    );
    expect(a.find(upd)).toHaveLength(0);

    const g = setup([
      [byId, () => [row()]],
      [/FROM users\s+WHERE id = \$1/, () => [{ id: 'a2' }]],
    ]);
    await g.service.update(
      'k1',
      { assigneeId: 'a2', dueDate: '2026-11-01', processId: null },
      gestor,
    );
    expect(g.find(upd)[0].sql).toMatch(
      /due_date = \$1::date, assignee_id = \$2, process_id = \$3/,
    );
    expect(g.find(upd)[0].params).toEqual([
      '2026-11-01',
      'a2',
      null,
      'k1',
      't1',
    ]);
  });

  it('trocar o processo confere o novo processo', async () => {
    const { service, find } = setup([
      [byId, () => [row()]],
      [/FROM processes/, () => []],
    ]);
    await expect(
      service.update('k1', { processId: 'p9' }, ana),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(find(upd)).toHaveLength(0);
  });

  it('exclusão lógica: autor ou gestor; analista que não criou → 403', async () => {
    const a = setup([[byId, () => [row({ created_by: 'g1' })]]]);
    await expect(a.service.remove('k1', ana)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const own = setup([[byId, () => [row({ created_by: 'a1' })]]]);
    await expect(own.service.remove('k1', ana)).resolves.toEqual({
      id: 'k1',
      deleted: true,
    });
    expect(own.find(/deleted_at = now\(\)/)[0].params).toEqual([
      'a1',
      'k1',
      't1',
    ]);
    const g = setup([[byId, () => [row()]]]);
    await g.service.remove('k1', gestor);
    expect(g.find(/deleted_at = now\(\)/)).toHaveLength(1);
  });
});

describe('TasksService.assignees (PROD-01)', () => {
  it('gestor: equipe ativa da assessoria; analista: só ele', async () => {
    const g = setup([
      [
        /FROM users/,
        () => [
          {
            id: 'g1',
            name: 'Gestora',
            surname: null,
            email: 'g@x',
            role: 'dono',
          },
          {
            id: 'a1',
            name: null,
            surname: null,
            email: 'ana@x',
            role: 'analista',
          },
        ],
      ],
    ]);
    expect(await g.service.assignees(gestor)).toEqual([
      { id: 'g1', name: 'Gestora', role: 'dono' },
      { id: 'a1', name: 'ana@x', role: 'analista' },
    ]);
    expect(g.calls[0].params).toEqual(['t1']);
    const a = setup();
    await a.service.assignees(ana);
    expect(a.calls[0].sql).toContain('AND id = $2');
    expect(a.calls[0].params).toEqual(['t1', 'a1']);
  });
});
