import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Empreendimento } from '../empreendimentos/empreendimento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Process } from '../processes/process.entity';
import { Document } from '../documents/document.entity';
import { ProcessParticipant } from '../participants/participant.entity';
import { InitialSchema1718500000000 } from './migrations/1718500000000-InitialSchema';
import { UnifyProcessStages1718500100000 } from './migrations/1718500100000-UnifyProcessStages';

// Standalone DataSource for the `typeorm migration:*` CLI. The running app builds
// its own connection from ConfigService (app.module) and runs migrations on boot
// (migrationsRun). This mirrors that config and loads the same root .env.local.
loadEnv({ path: '../.env.local' });
loadEnv({ path: '.env.local' });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME,
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  entities: [Tenant, User, Empreendimento, Unidade, Process, Document, ProcessParticipant],
  migrations: [InitialSchema1718500000000, UnifyProcessStages1718500100000],
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});
