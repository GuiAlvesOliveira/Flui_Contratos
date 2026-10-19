import { Test } from '@nestjs/testing';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { TasksController } from '../src/tasks/tasks.controller';
import { TasksService } from '../src/tasks/tasks.service';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
} from './support/test-db';

// PROD-01 — Tarefas pelo controller real, RolesGuard e a mesma ValidationPipe
// do main.ts. A autenticação está coberta em guards.e2e-spec.ts: aqui um guard
// de teste coloca na requisição o usuário indicado no cabeçalho x-as.
const users: Record<string, object> = {
  gestorA: { tenantId: IDS.tenantA, userId: IDS.gestorA, role: 'dono' },
  ana: { tenantId: IDS.tenantA, userId: IDS.anaA, role: 'analista' },
  bruno: { tenantId: IDS.tenantA, userId: IDS.brunoA, role: 'analista' },
  clienteA: { tenantId: IDS.tenantA, userId: IDS.clienteA, role: 'cliente' },
  gestorB: { tenantId: IDS.tenantB, userId: IDS.gestorB, role: 'dono' },
  analistaB: { tenantId: IDS.tenantB, userId: IDS.analistaB, role: 'analista' },
};

class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user: unknown }>();
    req.user = users[req.headers['x-as']];
    return true;
  }
}

async function makeApp(service: object): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TasksController],
    providers: [
      { provide: TasksService, useValue: service },
      { provide: APP_GUARD, useClass: FakeAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

const T = 'c1000000-0000-4000-8000-000000000001';

describe('Tarefas — rotas, papéis e validação (e2e, PROD-01)', () => {
  let app: INestApplication<App>;
  const service = {
    list: jest.fn().mockResolvedValue({ tasks: [], counts: {} }),
    assignees: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue({ id: T }),
    create: jest.fn().mockResolvedValue({ id: T }),
    update: jest.fn().mockResolvedValue({ id: T }),
    remove: jest.fn().mockResolvedValue({ id: T, deleted: true }),
  };
  beforeAll(async () => (app = await makeApp(service)));
  beforeEach(() => Object.values(service).forEach((fn) => fn.mockClear()));
  afterAll(() => app.close());
  const http = () => request(app.getHttpServer());

  it('o cliente não acessa nenhuma rota de tarefas (403)', async () => {
    await http().get('/tasks').set('x-as', 'clienteA').expect(403);
    await http().get('/tasks/assignees').set('x-as', 'clienteA').expect(403);
    await http().get(`/tasks/${T}`).set('x-as', 'clienteA').expect(403);
    await http()
      .post('/tasks')
      .set('x-as', 'clienteA')
      .send({ title: 'Tarefa', dueDate: '2026-10-20' })
      .expect(403);
    await http()
      .patch(`/tasks/${T}`)
      .set('x-as', 'clienteA')
      .send({ status: 'concluida' })
      .expect(403);
    await http().delete(`/tasks/${T}`).set('x-as', 'clienteA').expect(403);
    Object.values(service).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('título com espaços nas pontas é aparado; descrição em branco vira null', async () => {
    await http()
      .post('/tasks')
      .set('x-as', 'ana')
      .send({
        title: '  Ligar para o cliente ',
        description: '   ',
        dueDate: '2026-10-20',
      })
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(
      {
        title: 'Ligar para o cliente',
        description: null,
        dueDate: '2026-10-20',
      },
      users.ana,
    );
  });

  it.each([
    ['sem título', { dueDate: '2026-10-20' }],
    ['título curto', { title: 'ok', dueDate: '2026-10-20' }],
    ['título longo', { title: 'x'.repeat(201), dueDate: '2026-10-20' }],
    ['sem prazo', { title: 'Tarefa' }],
    ['prazo impossível', { title: 'Tarefa', dueDate: '2026-02-30' }],
    ['prazo em outro formato', { title: 'Tarefa', dueDate: '20/10/2026' }],
    [
      'processo que não é UUID',
      { title: 'Tarefa', dueDate: '2026-10-20', processId: 'abc' },
    ],
    [
      'forjando o autor',
      { title: 'Tarefa', dueDate: '2026-10-20', createdBy: IDS.gestorA },
    ],
    [
      'forjando a assessoria',
      { title: 'Tarefa', dueDate: '2026-10-20', tenantId: IDS.tenantB },
    ],
    [
      'status na criação',
      { title: 'Tarefa', dueDate: '2026-10-20', status: 'concluida' },
    ],
  ])('recusa a criação %s (400)', async (_c, body) => {
    await http().post('/tasks').set('x-as', 'ana').send(body).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('recusa status inválido e filtros inválidos (400)', async () => {
    await http()
      .patch(`/tasks/${T}`)
      .set('x-as', 'ana')
      .send({ status: 'feita' })
      .expect(400);
    await http().get('/tasks?due=ontem').set('x-as', 'ana').expect(400);
    await http().get('/tasks?from=2026-13-01').set('x-as', 'ana').expect(400);
    await http().get('/tasks/abc').set('x-as', 'ana').expect(400);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
  });

  it('PATCH aceita processId null para desvincular', async () => {
    await http()
      .patch(`/tasks/${T}`)
      .set('x-as', 'gestorA')
      .send({ processId: null })
      .expect(200);
    expect(service.update).toHaveBeenCalledWith(
      T,
      { processId: null },
      users.gestorA,
    );
  });
});

// Serviço real + PostgreSQL real: isolamento entre assessorias e regras de quem
// vê, cria, reatribui e exclui.
interface TaskJson {
  id: string;
  title: string;
  status: string;
  overdue: boolean;
  daysLate: number;
  completedAt: string | null;
  assignee: { id: string; name: string };
  process: { id: string; clientName: string; stage: string } | null;
}
interface ListJson {
  tasks: TaskJson[];
  counts: Record<string, number>;
}
const json = <T>(r: { body: unknown }) => r.body as T;
const ids = (l: ListJson) => l.tasks.map((t) => t.id);

describeDb(
  'Tarefas — isolamento entre assessorias com banco real (e2e, PROD-01)',
  () => {
    let db: TestDb;
    let app: INestApplication<App>;
    const http = () => request(app.getHttpServer());
    const day = (offset: number) => {
      const d = new Date(Date.now() - 3 * 3600_000); // dia de São Paulo
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const create = (as: string, body: object) =>
      http().post('/tasks').set('x-as', as).send(body);
    const list = async (as: string, qs = '') =>
      json<ListJson>(
        await http().get(`/tasks${qs}`).set('x-as', as).expect(200),
      );
    const row = async <T>(sql: string, id: string) =>
      (await db.dataSource.query<T[]>(sql, [id]))[0];

    let taskAna: string;
    let taskB: string;

    beforeAll(async () => {
      db = await createTestDb('tasks');
      await seedTwoTenants(db.dataSource);
      app = await makeApp(new TasksService(db.dataSource));
    }, 60_000);
    afterAll(async () => {
      await app?.close();
      await db?.drop();
    });

    it('o gestor cria e atribui a um analista; o analista cria só para si', async () => {
      const a = json<TaskJson>(
        await create('gestorA', {
          title: 'Cobrar holerite',
          dueDate: day(-2),
          processId: IDS.processoAna,
          assigneeId: IDS.anaA,
        }).expect(201),
      );
      taskAna = a.id;
      expect(a).toMatchObject({
        assignee: { id: IDS.anaA, name: 'Ana' },
        process: {
          id: IDS.processoAna,
          clientName: 'Carla Cliente',
          stage: 'cadastro',
        },
        status: 'a_fazer',
        overdue: true,
        daysLate: 2,
      });
      const own = json<TaskJson>(
        await create('ana', {
          title: 'Agendar vistoria',
          dueDate: day(0),
        }).expect(201),
      );
      expect(own.assignee.id).toBe(IDS.anaA);
      await create('ana', {
        title: 'Para o Bruno',
        dueDate: day(1),
        assigneeId: IDS.brunoA,
      }).expect(403);
      taskB = json<TaskJson>(
        await create('gestorB', {
          title: 'Tarefa da Beta',
          dueDate: day(3),
          processId: IDS.processoB,
        }).expect(201),
      ).id;
    });

    it('cada assessoria só enxerga as próprias tarefas (RN-01)', async () => {
      const a = await list('gestorA');
      const b = await list('gestorB');
      expect(ids(a)).toContain(taskAna);
      expect(ids(a)).not.toContain(taskB);
      expect(ids(b)).toEqual([taskB]);
      expect(b.counts.total).toBe(1);
    });

    it('a outra assessoria recebe 404 ao ler, alterar ou excluir — e nada muda', async () => {
      await http().get(`/tasks/${taskAna}`).set('x-as', 'gestorB').expect(404);
      await http()
        .patch(`/tasks/${taskAna}`)
        .set('x-as', 'gestorB')
        .send({ status: 'concluida' })
        .expect(404);
      await http()
        .delete(`/tasks/${taskAna}`)
        .set('x-as', 'gestorB')
        .expect(404);
      expect(
        await row<{ status: string; deleted_at: Date | null }>(
          `SELECT status, deleted_at FROM tasks WHERE id = $1`,
          taskAna,
        ),
      ).toEqual({ status: 'a_fazer', deleted_at: null });
    });

    it('não liga processo nem atribui pessoa de outra assessoria (404)', async () => {
      await create('gestorB', {
        title: 'Processo alheio',
        dueDate: day(1),
        processId: IDS.processoAna,
      }).expect(404);
      await create('gestorB', {
        title: 'Pessoa alheia',
        dueDate: day(1),
        assigneeId: IDS.anaA,
      }).expect(404);
      await http()
        .patch(`/tasks/${taskB}`)
        .set('x-as', 'gestorB')
        .send({ assigneeId: IDS.brunoA })
        .expect(404);
      const assignees = json<{ id: string }[]>(
        await http().get('/tasks/assignees').set('x-as', 'gestorB').expect(200),
      );
      expect(assignees.map((u) => u.id).sort()).toEqual(
        [IDS.gestorB, IDS.analistaB].sort(),
      );
    });

    it('o analista vê só as dele; outro analista da mesma assessoria recebe 404', async () => {
      const ana = await list('ana');
      expect(ana.tasks.every((t) => t.assignee.id === IDS.anaA)).toBe(true);
      await http().get(`/tasks/${taskAna}`).set('x-as', 'bruno').expect(404);
      expect((await list('bruno')).tasks).toEqual([]);
    });

    it('o analista só liga processos dele e não reatribui; o gestor reatribui', async () => {
      await http()
        .patch(`/tasks/${taskAna}`)
        .set('x-as', 'ana')
        .send({ processId: IDS.processoBruno })
        .expect(404);
      await http()
        .patch(`/tasks/${taskAna}`)
        .set('x-as', 'ana')
        .send({ assigneeId: IDS.brunoA })
        .expect(403);
      await create('gestorA', {
        title: 'Para desativado',
        dueDate: day(1),
        assigneeId: IDS.desativadoA,
      }).expect(404);
      const r = json<TaskJson>(
        await http()
          .patch(`/tasks/${taskAna}`)
          .set('x-as', 'gestorA')
          .send({ assigneeId: IDS.brunoA })
          .expect(200),
      );
      expect(r.assignee).toEqual({ id: IDS.brunoA, name: 'Bruno' });
      await http().get(`/tasks/${taskAna}`).set('x-as', 'bruno').expect(200);
      await http()
        .patch(`/tasks/${taskAna}`)
        .set('x-as', 'gestorA')
        .send({ assigneeId: IDS.anaA })
        .expect(200);
    });

    it('concluir grava quem e quando; reabrir limpa; concluída deixa de estar atrasada', async () => {
      const done = json<TaskJson>(
        await http()
          .patch(`/tasks/${taskAna}`)
          .set('x-as', 'ana')
          .send({ status: 'concluida' })
          .expect(200),
      );
      expect(done).toMatchObject({ status: 'concluida', overdue: false });
      expect(done.completedAt).not.toBeNull();
      expect(
        (
          await row<{ completed_by: string }>(
            `SELECT completed_by FROM tasks WHERE id = $1`,
            taskAna,
          )
        ).completed_by,
      ).toBe(IDS.anaA);
      const reopened = json<TaskJson>(
        await http()
          .patch(`/tasks/${taskAna}`)
          .set('x-as', 'ana')
          .send({ status: 'em_andamento' })
          .expect(200),
      );
      expect(reopened).toMatchObject({
        status: 'em_andamento',
        overdue: true,
        completedAt: null,
      });
    });

    it('filtros: atrasadas, hoje, status e intervalo do calendário, com contagens', async () => {
      const late = await list('gestorA', '?due=atrasadas');
      expect(ids(late)).toEqual([taskAna]);
      expect(
        (await list('gestorA', '?due=hoje')).tasks.map((t) => t.title),
      ).toEqual(['Agendar vistoria']);
      expect(
        (await list('gestorA', '?status=em_andamento')).tasks,
      ).toHaveLength(1);
      expect(
        ids(await list('gestorA', `?from=${day(-3)}&to=${day(-1)}`)),
      ).toEqual([taskAna]);
      expect(late.counts).toMatchObject({
        total: 2,
        atrasadas: 1,
        hoje: 1,
        em_andamento: 1,
        a_fazer: 1,
      });
    });

    it('só quem criou (ou o gestor) exclui; a exclusão é lógica', async () => {
      await http().delete(`/tasks/${taskAna}`).set('x-as', 'ana').expect(403); // criada pelo gestor
      await http()
        .delete(`/tasks/${taskAna}`)
        .set('x-as', 'gestorA')
        .expect(200);
      await http().get(`/tasks/${taskAna}`).set('x-as', 'gestorA').expect(404);
      expect(
        (
          await row<{ deleted_by: string }>(
            `SELECT deleted_by FROM tasks WHERE id = $1`,
            taskAna,
          )
        ).deleted_by,
      ).toBe(IDS.gestorA);
    });
  },
);
