import { UserContextCache } from './user-context.cache';
import { RequestUserFull } from './supabase.guard';

const ctx = (userId: string, externalId = `ext-${userId}`) =>
  ({ userId, externalId, tenantId: 't1', role: 'analista' }) as RequestUserFull;

describe('UserContextCache (AUTH-09)', () => {
  it('returns a cached context within the 60s TTL and drops it after', () => {
    const cache = new UserContextCache();
    cache.set('ext-u1', ctx('u1'), 1_000);
    expect(cache.get('ext-u1', 1_000 + 59_999)).toEqual(ctx('u1'));
    expect(cache.get('ext-u1', 1_000 + 60_000)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('invalidateUser removes the entries of that user only', () => {
    const cache = new UserContextCache();
    cache.set('ext-u1', ctx('u1'));
    cache.set('ext-u1-other-session', ctx('u1', 'ext-u1-other-session'));
    cache.set('ext-u2', ctx('u2'));
    cache.invalidateUser('u1');
    expect(cache.get('ext-u1')).toBeNull();
    expect(cache.get('ext-u1-other-session')).toBeNull();
    expect(cache.get('ext-u2')).toEqual(ctx('u2'));
  });

  it('invalidating a user that is not cached is a no-op', () => {
    const cache = new UserContextCache();
    cache.set('ext-u2', ctx('u2'));
    cache.invalidateUser('nobody');
    expect(cache.size).toBe(1);
  });

  it('pruneExpired clears only expired entries', () => {
    const cache = new UserContextCache();
    cache.set('ext-old', ctx('old'), 0);
    cache.set('ext-new', ctx('new'), 50_000);
    cache.pruneExpired(60_000);
    expect(cache.size).toBe(1);
    expect(cache.get('ext-new', 60_000)).toEqual(ctx('new'));
  });
});
