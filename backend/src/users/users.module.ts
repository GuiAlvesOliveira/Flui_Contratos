import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { TemporaryPasswordStore } from '../common/services/temporary-password.store';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Tenant])],
  controllers: [UsersController],
  providers: [UsersService, SupabaseAdminService, TemporaryPasswordStore],
})
export class UsersModule {}
