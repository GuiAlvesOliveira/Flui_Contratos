import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from './audit/audit.module';
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
import { SupabaseGuard } from './auth/supabase.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { Document } from './documents/document.entity';
import { Empreendimento } from './empreendimentos/empreendimento.entity';
import { Process } from './processes/process.entity';
import { Tenant } from './tenants/tenant.entity';
import { Unidade } from './unidades/unidade.entity';
import { User } from './users/user.entity';

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
        entities: [Tenant, User, Empreendimento, Unidade, Process, Document, ProcessParticipant],
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
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
