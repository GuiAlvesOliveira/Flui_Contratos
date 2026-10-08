import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Empreendimento } from '../empreendimentos/empreendimento.entity';
import { Unidade } from '../unidades/unidade.entity';
import { Process } from '../processes/process.entity';
import { Document } from '../documents/document.entity';
import { DocumentType } from '../documents/document-type.entity';
import { ProcessParticipant } from '../participants/participant.entity';
import { InitialSchema1718500000000 } from './migrations/1718500000000-InitialSchema';
import { UnifyProcessStages1718500100000 } from './migrations/1718500100000-UnifyProcessStages';
import { AddStageBeforePendencia1718500200000 } from './migrations/1718500200000-AddStageBeforePendencia';
import { AddUserStatus1718500300000 } from './migrations/1718500300000-AddUserStatus';
import { AddUserDataNascimento1718500400000 } from './migrations/1718500400000-AddUserDataNascimento';
import { AddDocumentTypes1718500500000 } from './migrations/1718500500000-AddDocumentTypes';
import { AddEmpreendimentoTeam1718500600000 } from './migrations/1718500600000-AddEmpreendimentoTeam';
import { AddNotificationReads1718500700000 } from './migrations/1718500700000-AddNotificationReads';
import { AddDocumentForms1718500800000 } from './migrations/1718500800000-AddDocumentForms';

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
  entities: [
    Tenant,
    User,
    Empreendimento,
    Unidade,
    Process,
    Document,
    DocumentType,
    ProcessParticipant,
  ],
  migrations: [
    InitialSchema1718500000000,
    UnifyProcessStages1718500100000,
    AddStageBeforePendencia1718500200000,
    AddUserStatus1718500300000,
    AddUserDataNascimento1718500400000,
    AddDocumentTypes1718500500000,
    AddEmpreendimentoTeam1718500600000,
    AddNotificationReads1718500700000,
    AddDocumentForms1718500800000,
  ],
  installExtensions: false, // same as app.module: gen_random_uuid() is built in
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});
