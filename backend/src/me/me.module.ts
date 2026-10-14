import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { TemporaryPasswordStore } from '../common/services/temporary-password.store';
import { User } from '../users/user.entity';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [MeController],
  providers: [MeService, SupabaseAdminService, TemporaryPasswordStore],
})
export class MeModule {}
