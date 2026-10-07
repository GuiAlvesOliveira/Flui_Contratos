import { ThrottlerGuard } from '@nestjs/throttler';
import { SupabaseGuard } from '../../auth/supabase.guard';
import { TenantGuard } from './tenant.guard';
import { RolesGuard } from './roles.guard';

/**
 * Global guard chain, in execution order: rate limit first (cheap, blocks
 * floods before any auth I/O), then token → tenant/role lookup → role check.
 * Registered as APP_GUARDs by AppModule; the e2e suite builds the same chain
 * from this list, so the order it tests is the production order (QA-02).
 */
export const GLOBAL_GUARDS = [
  ThrottlerGuard,
  SupabaseGuard,
  TenantGuard,
  RolesGuard,
] as const;
