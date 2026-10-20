import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../src/database/data-source';

/**
 * e2e com PostgreSQL de verdade (PROD-01, PROD-05_v2...). Cada suíte cria um
 * banco temporário no servidor de E2E_DATABASE_URL, aplica todas as migrations
 * do projeto e apaga o banco no fim. Sem a variável, essas suítes são puladas
 * (no CI ela vem do serviço postgres do job de testes).
 *
 *   E2E_DATABASE_URL=postgres://usuario:senha@localhost:5432/postgres npm run test:e2e
 */
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL;
export const describeDb = E2E_DATABASE_URL ? describe : describe.skip;

export interface TestDb {
  dataSource: DataSource;
  name: string;
  drop: () => Promise<void>;
}

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function createTestDb(label: string): Promise<TestDb> {
  if (!E2E_DATABASE_URL) throw new Error('E2E_DATABASE_URL não definida');
  const name = `flui_e2e_${label}_${process.pid}_${Date.now()}`.toLowerCase();
  const admin = new Client({ connectionString: E2E_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const dataSource = new DataSource({
    type: 'postgres',
    url: withDatabase(E2E_DATABASE_URL, name),
    migrations: AppDataSource.options.migrations,
    // as entidades permitem usar os serviços reais (repositórios do TypeORM)
    entities: AppDataSource.options.entities,
    installExtensions: false,
    logging: false,
  });
  await dataSource.initialize();
  await dataSource.runMigrations();

  return {
    dataSource,
    name,
    drop: async () => {
      await dataSource.destroy();
      const c = new Client({ connectionString: E2E_DATABASE_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

// Duas assessorias com gestor, analistas, cliente e processos — base dos
// testes de isolamento (RN-01).
export const IDS = {
  tenantA: 'a1000000-0000-4000-8000-000000000001',
  tenantB: 'b1000000-0000-4000-8000-000000000001',
  gestorA: 'a2000000-0000-4000-8000-000000000001',
  anaA: 'a2000000-0000-4000-8000-000000000002',
  brunoA: 'a2000000-0000-4000-8000-000000000003',
  clienteA: 'a2000000-0000-4000-8000-000000000004',
  desativadoA: 'a2000000-0000-4000-8000-000000000005',
  gestorB: 'b2000000-0000-4000-8000-000000000001',
  analistaB: 'b2000000-0000-4000-8000-000000000002',
  clienteB: 'b2000000-0000-4000-8000-000000000003',
  processoAna: 'a3000000-0000-4000-8000-000000000001',
  processoBruno: 'a3000000-0000-4000-8000-000000000002',
  processoB: 'b3000000-0000-4000-8000-000000000001',
} as const;

export async function seedTwoTenants(ds: DataSource): Promise<void> {
  const i = IDS;
  await ds.query(
    `INSERT INTO tenants (id, name, slug) VALUES
       ($1, 'Assessoria Alfa', 'alfa-e2e'), ($2, 'Assessoria Beta', 'beta-e2e')`,
    [i.tenantA, i.tenantB],
  );
  const users: [string, string, string, string, string][] = [
    [i.gestorA, i.tenantA, 'dono', 'Gestora Alfa', 'active'],
    [i.anaA, i.tenantA, 'analista', 'Ana', 'active'],
    [i.brunoA, i.tenantA, 'analista', 'Bruno', 'active'],
    [i.clienteA, i.tenantA, 'cliente', 'Carla Cliente', 'active'],
    [i.desativadoA, i.tenantA, 'analista', 'Davi Desativado', 'disabled'],
    [i.gestorB, i.tenantB, 'dono', 'Gestor Beta', 'active'],
    [i.analistaB, i.tenantB, 'analista', 'Bia Beta', 'active'],
    [i.clienteB, i.tenantB, 'cliente', 'Caio Beta', 'active'],
  ];
  for (const [id, tenant, role, name, status] of users) {
    await ds.query(
      `INSERT INTO users (id, tenant_id, role, name, email, status, onboarding_completed)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [id, tenant, role, name, `${id}@e2e.exemplo.dev`, status],
    );
  }
  await ds.query(
    `INSERT INTO processes (id, tenant_id, client_id, analista_id, stage) VALUES
       ($1, $4, $6, $7, 'cadastro'),
       ($2, $4, $6, $8, 'analise_credito'),
       ($3, $5, $9, $10, 'cadastro')`,
    [
      i.processoAna,
      i.processoBruno,
      i.processoB,
      i.tenantA,
      i.tenantB,
      i.clienteA,
      i.anaA,
      i.brunoA,
      i.clienteB,
      i.analistaB,
    ],
  );
}
