import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import { ParticipantsModule } from './participants/participants.module';
import { ProcessParticipant } from './participants/participant.entity';
import { DocumentsModule } from './documents/documents.module';
import { EmailModule } from './email/email.module';
import { EmpreendimentosModule } from './empreendimentos/empreendimentos.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { ProcessesModule } from './processes/processes.module';
import { TenantsModule } from './tenants/tenants.module';
import { UnidadesModule } from './unidades/unidades.module';
import { UsersModule } from './users/users.module';
import { GLOBAL_GUARDS } from './common/guards/global-guards';
import { Document } from './documents/document.entity';
import { DocumentType } from './documents/document-type.entity';
import { Empreendimento } from './empreendimentos/empreendimento.entity';
import { Process } from './processes/process.entity';
import { Tenant } from './tenants/tenant.entity';
import { Unidade } from './unidades/unidade.entity';
import { User } from './users/user.entity';
import { InitialSchema1718500000000 } from './database/migrations/1718500000000-InitialSchema';
import { UnifyProcessStages1718500100000 } from './database/migrations/1718500100000-UnifyProcessStages';
import { AddStageBeforePendencia1718500200000 } from './database/migrations/1718500200000-AddStageBeforePendencia';
import { AddUserStatus1718500300000 } from './database/migrations/1718500300000-AddUserStatus';
import { AddUserDataNascimento1718500400000 } from './database/migrations/1718500400000-AddUserDataNascimento';
import { AddDocumentTypes1718500500000 } from './database/migrations/1718500500000-AddDocumentTypes';
import { AddEmpreendimentoTeam1718500600000 } from './database/migrations/1718500600000-AddEmpreendimentoTeam';
import { AddNotificationReads1718500700000 } from './database/migrations/1718500700000-AddNotificationReads';

@Module({
  imports: [
    // Global rate limit (per IP). Generous ceiling — blocks floods/brute force
    // without tripping normal use; tune as needed (SEC-04).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env.local', '.env.local'],
      expandVariables: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DATABASE_HOST'),
        port: config.get<number>('DATABASE_PORT', 5432),
        database: config.get<string>('DATABASE_NAME'),
        username: config.get<string>('DATABASE_USER'),
        password: config.get<string>('DATABASE_PASSWORD'),
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
        ],
        migrationsRun: true,
        synchronize: false,
        ssl:
          config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: true }
            : false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, Tenant]),
    AuditModule,
    DashboardModule,
    NotificationsModule,
    AuthModule,
    ParticipantsModule,
    DocumentsModule,
    EmailModule,
    EmpreendimentosModule,
    HealthModule,
    MeModule,
    ProcessesModule,
    TenantsModule,
    UnidadesModule,
    UsersModule,
  ],
  providers: GLOBAL_GUARDS.map((guard) => ({
    provide: APP_GUARD,
    useClass: guard,
  })),
})
export class AppModule {}
