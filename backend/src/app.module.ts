import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivitiesModule } from './activities/activities.module';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SearchModule } from './search/search.module';
import { AuthModule } from './auth/auth.module';
import { PasswordResetModule } from './auth/password-reset.module';
import { ParticipantsModule } from './participants/participants.module';
import { ProcessParticipant } from './participants/participant.entity';
import { DocumentsModule } from './documents/documents.module';
import { EmailModule } from './email/email.module';
import { EmpreendimentosModule } from './empreendimentos/empreendimentos.module';
import { MessagingModule } from './messaging/messaging.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { ProcessesModule } from './processes/processes.module';
import { TenantsModule } from './tenants/tenants.module';
import { UnidadesModule } from './unidades/unidades.module';
import { UsersModule } from './users/users.module';
import { GLOBAL_GUARDS } from './common/guards/global-guards';
import { UsageTelemetryInterceptor } from './common/interceptors/usage-telemetry.interceptor';
import { TelemetryService } from './common/services/telemetry.service';
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
import { AddDocumentForms1718500800000 } from './database/migrations/1718500800000-AddDocumentForms';
import { AddMessageOutbox1718500900000 } from './database/migrations/1718500900000-AddMessageOutbox';
import { AddProcessActivities1718501000000 } from './database/migrations/1718501000000-AddProcessActivities';
import { AddActivityEditedBy1718501100000 } from './database/migrations/1718501100000-AddActivityEditedBy';
import { AddUserTempPasswords1718501200000 } from './database/migrations/1718501200000-AddUserTempPasswords';
import { AddUserAddress1718501300000 } from './database/migrations/1718501300000-AddUserAddress';
import { AddTenantBranding1718501400000 } from './database/migrations/1718501400000-AddTenantBranding';

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
          AddDocumentForms1718500800000,
          AddMessageOutbox1718500900000,
          AddProcessActivities1718501000000,
          AddActivityEditedBy1718501100000,
          AddUserTempPasswords1718501200000,
          AddUserAddress1718501300000,
          AddTenantBranding1718501400000,
        ],
        migrationsRun: true,
        synchronize: false,
        // The schema uses the built-in gen_random_uuid(); trying to create the
        // uuid-ossp extension (not allow-listed on Azure) only logged a 0A000
        // error on every boot.
        installExtensions: false,
        ssl:
          config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: true }
            : false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, Tenant]),
    ActivitiesModule,
    AuditModule,
    DashboardModule,
    NotificationsModule,
    SearchModule,
    AuthModule,
    PasswordResetModule,
    ParticipantsModule,
    DocumentsModule,
    EmailModule,
    MessagingModule,
    EmpreendimentosModule,
    HealthModule,
    MeModule,
    ProcessesModule,
    TenantsModule,
    UnidadesModule,
    UsersModule,
  ],
  providers: [
    ...GLOBAL_GUARDS.map((guard) => ({
      provide: APP_GUARD,
      useClass: guard,
    })),
    // VAL-04: eventos de uso (login, processo criado, avanço de etapa...) no App Insights
    TelemetryService,
    { provide: APP_INTERCEPTOR, useClass: UsageTelemetryInterceptor },
  ],
})
export class AppModule {}
