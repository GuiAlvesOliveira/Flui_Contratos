import { Injectable } from '@nestjs/common';
import { RequestUserFull } from './supabase.guard';

/**
 * AUTH-09: per-process cache of the user context TenantGuard resolves from the
 * DB (tenant, role, status flags), keyed by the Supabase user id (externalId),
 * so most requests skip the users lookup. Entries live TTL_MS; any change to a
 * user that the context depends on must call invalidateUser(userId) so it takes
 * effect on the next request instead of up to TTL_MS later.
 *
 * The cache is in memory: with more than one API instance, each instance keeps
 * its own copy and the others still converge within TTL_MS.
 */
@Injectable()
export class UserContextCache {
  static readonly TTL_MS = 60_000;

  private readonly entries = new Map<
    string,
    { data: RequestUserFull; expiresAt: number }
  >();

  get(externalId: string, now = Date.now()): RequestUserFull | null {
    const entry = this.entries.get(externalId);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.entries.delete(externalId);
      return null;
    }
    return entry.data;
  }

  set(externalId: string, data: RequestUserFull, now = Date.now()): void {
    this.entries.set(externalId, {
      data,
      expiresAt: now + UserContextCache.TTL_MS,
    });
  }

  /** Drops every cached context of the user with this DB id (users.id). */
  invalidateUser(userId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.data.userId === userId) this.entries.delete(key);
    }
  }

  pruneExpired(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
