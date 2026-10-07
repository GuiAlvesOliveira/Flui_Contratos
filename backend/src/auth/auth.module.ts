import { Global, Module } from '@nestjs/common';
import { SupabaseGuard } from './supabase.guard';
import { UserContextCache } from './user-context.cache';

// Global so the APP_GUARD TenantGuard and the users/me services share one
// UserContextCache instance (AUTH-09).
@Global()
@Module({
  providers: [SupabaseGuard, UserContextCache],
  exports: [SupabaseGuard, UserContextCache],
})
export class AuthModule {}
