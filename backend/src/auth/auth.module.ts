import { Module } from '@nestjs/common';
import { SupabaseGuard } from './supabase.guard';

@Module({
  providers: [SupabaseGuard],
  exports: [SupabaseGuard],
})
export class AuthModule {}
