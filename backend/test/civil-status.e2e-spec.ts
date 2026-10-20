import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { RequestUserFull } from '../src/auth/supabase.guard';
import { MeService } from '../src/me/me.service';
import { MessagingService } from '../src/messaging/messaging.service';
import { Process } from '../src/processes/process.entity';
import { ProcessesService } from '../src/processes/processes.service';
import { User } from '../src/users/user.entity';
import {
  createTestDb,
  describeDb,
  IDS,
  seedTwoTenants,
  type TestDb,
  undoMigrationsThrough,
} from './support/test-db';

// Estado civil e fonte de renda com PostgreSQL de verdade: o banco aceita as
// cinco opções da tela, o onboarding do cliente preenche os processos dele sem
// trocar o que a equipe já informou, e um processo novo herda o que ele declarou.
const who = (tenantId: string, userId: string, role: string) =>
  ({ tenantId, userId, role }) as RequestUserFull;
const ana = who(IDS.tenantA, IDS.anaA, 'analista');
const gestorA = who(IDS.tenantA, IDS.gestorA, 'dono');
const clienteA = who(IDS.tenantA, IDS.clienteA, 'cliente');

describeDb('Estado civil e fonte de renda com banco real (e2e)', () => {
  let db: TestDb;
  let me: MeService;
  let processes: ProcessesService;
  const ds = () => db.dataSource;
  const proc = async (id: string) =>
    (
      await ds().query<
        { estado_civil: string | null; fonte_renda: string | null }[]
      >(`SELECT estado_civil, fonte_renda FROM processes WHERE id = $1`, [id])
    )[0];
  const config = {
    get: (k: string) =>
      k === 'FRONTEND_URL' ? 'https://app.exemplo.dev' : undefined,
  } as unknown as ConfigService;

  beforeAll(async () => {
    db = await createTestDb('civilstatus');
    await seedTwoTenants(ds());
    me = new MeService(
      ds().getRepository(User),
      {} as never,
      { invalidateUser: jest.fn() } as never,
      { remove: jest.fn() } as never,
      ds(),
    );
    processes = new ProcessesService(
      ds().getRepository(Process),
      ds().getRepository(User),
      ds(),
      new MessagingService(config, { soon: jest.fn() } as never),
    );
  }, 60_000);
  afterAll(async () => {
    await db?.drop();
  });

  it('o processo aceita viúvo(a) e união estável pela API e pelo banco; o banco recusa outros valores', async () => {
    for (const estadoCivil of ['viuvo', 'uniao_estavel']) {
      await processes.updateFields(
        IDS.processoB,
        { estadoCivil },
        who(IDS.tenantB, IDS.gestorB, 'dono'),
      );
      expect((await proc(IDS.processoB)).estado_civil).toBe(estadoCivil);
    }
    await expect(
      ds().query(`UPDATE processes SET estado_civil = 'noivo' WHERE id = $1`, [
        IDS.processoB,
      ]),
    ).rejects.toThrow(/processes_estado_civil_check/);
    await expect(
      ds().query(`UPDATE users SET estado_civil = 'noivo' WHERE id = $1`, [
        IDS.clienteB,
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      ds().query(`UPDATE users SET fonte_renda = 'outra' WHERE id = $1`, [
        IDS.clienteB,
      ]),
    ).rejects.toThrow(/check constraint/);
  });

  it('onboarding do cliente: guarda nele e preenche só o que falta nos processos ativos dele', async () => {
    // a equipe já informou o estado civil no processo da Bruno; há um processo removido
    await ds().query(
      `UPDATE processes SET estado_civil = 'casado' WHERE id = $1`,
      [IDS.processoBruno],
    );
    const removido = randomUUID();
    await ds().query(
      `INSERT INTO processes (id, tenant_id, client_id, stage, active) VALUES ($1, $2, $3, 'cadastro', false)`,
      [removido, IDS.tenantA, IDS.clienteA],
    );
    const antesB = await proc(IDS.processoB);

    await me.completeOnboarding(clienteA, {
      name: 'Carla Cliente',
      estadoCivil: 'uniao_estavel',
      fonteRenda: 'assalariado',
    });

    expect(await proc(IDS.processoAna)).toEqual({
      estado_civil: 'uniao_estavel',
      fonte_renda: 'assalariado',
    });
    expect(await proc(IDS.processoBruno)).toEqual({
      estado_civil: 'casado',
      fonte_renda: 'assalariado',
    });
    expect(await proc(removido)).toEqual({
      estado_civil: null,
      fonte_renda: null,
    });
    expect(await proc(IDS.processoB)).toEqual(antesB); // outra assessoria
    const [user] = await ds().query<
      {
        estado_civil: string;
        fonte_renda: string;
        onboarding_completed: boolean;
      }[]
    >(
      `SELECT estado_civil, fonte_renda, onboarding_completed FROM users WHERE id = $1`,
      [IDS.clienteA],
    );
    expect(user).toEqual({
      estado_civil: 'uniao_estavel',
      fonte_renda: 'assalariado',
      onboarding_completed: true,
    });

    // o Log de Ações de cada processo diz o que foi preenchido, com o cliente como autor
    const logs = await ds().query<
      { process_id: string; actor_id: string; fields: string }[]
    >(
      `SELECT process_id, actor_id, metadata->>'fields' AS fields FROM audit_logs
        WHERE action = 'profile_update' ORDER BY process_id`,
    );
    expect(logs).toEqual(
      [
        {
          process_id: IDS.processoAna,
          actor_id: IDS.clienteA,
          fields: 'estadoCivil, fonteRenda',
        },
        {
          process_id: IDS.processoBruno,
          actor_id: IDS.clienteA,
          fields: 'fonteRenda',
        },
      ].sort((a, b) => a.process_id.localeCompare(b.process_id)),
    );
  });

  it('um processo criado depois herda o que o cliente declarou (e a equipe pode mudar)', async () => {
    const created = await processes.create({ clientId: IDS.clienteA }, gestorA);
    expect(await proc(created.id)).toEqual({
      estado_civil: 'uniao_estavel',
      fonte_renda: 'assalariado',
    });
    await processes.updateFields(created.id, { estadoCivil: 'casado' }, ana);
    expect((await proc(created.id)).estado_civil).toBe('casado');
    // cliente que não declarou: o processo nasce sem esses dados, como antes
    const semFicha = await processes.create(
      { clientId: IDS.clienteB },
      who(IDS.tenantB, IDS.gestorB, 'dono'),
    );
    expect(await proc(semFicha.id)).toEqual({
      estado_civil: null,
      fonte_renda: null,
    });
  });

  it('a migration reverte e é aplicada de novo com processos já usando as opções novas', async () => {
    await undoMigrationsThrough(ds(), 'AddUserCivilStatus1718501900000');
    const [{ n }] = await ds().query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('estado_civil', 'fonte_renda')`,
    );
    expect(n).toBe(0);
    await ds().runMigrations();
    expect((await proc(IDS.processoAna)).estado_civil).toBe('uniao_estavel');
    await processes.updateFields(
      IDS.processoAna,
      { estadoCivil: 'viuvo' },
      ana,
    );
    expect((await proc(IDS.processoAna)).estado_civil).toBe('viuvo');
  });
});
