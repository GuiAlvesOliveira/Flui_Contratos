import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupabaseAdminService } from '../common/services/supabase-admin.service';
import { User } from '../users/user.entity';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [PasswordResetController],
  providers: [PasswordResetService, SupabaseAdminService],
})
export class PasswordResetModule {}
