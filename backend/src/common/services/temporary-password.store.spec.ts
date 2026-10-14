import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TemporaryPasswordStore } from './temporary-password.store';

// In-memory stand-in for the user_temp_passwords table: enough to check what
// the store writes and that it reads back only what it wrote.
function makeStore(env: Record<string, string | undefined>) {
  const rows = new Map<string, { secret: string; created_at: Date }>();
  const query = jest.fn((sql: string, params: string[]) => {
    if (sql.startsWith('INSERT')) {
      rows.set(params[0], { secret: params[2], created_at: new Date() });
      return Promise.resolve([]);
    }
    if (sql.startsWith('SELECT')) {
      const row = rows.get(params[0]);
      return Promise.resolve(row ? [row] : []);
    }
    rows.delete(params[0]);
    return Promise.resolve([]);
  });
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const store = new TemporaryPasswordStore(
    { query } as unknown as DataSource,
    config,
  );
  return { store, rows, query };
}

const PWD = '3f9a1c0b7d2e4f6a8b9c0d1e2f3a4b5c';
const ENV = { SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-de-teste' };

describe('TemporaryPasswordStore (BE-18)', () => {
  it('reads back the password it kept, and never stores it in plain text', async () => {
    const { store, rows } = makeStore(ENV);
    await store.save('u1', 't1', PWD, 'g1');
    const secret = rows.get('u1')!.secret;
    expect(secret).toMatch(/^v1\./);
    expect(secret).not.toContain(PWD);
    expect(
      Buffer.from(secret.split('.')[3], 'base64').toString('utf8'),
    ).not.toContain(PWD);
    await expect(store.read('u1')).resolves.toMatchObject({ password: PWD });
  });

  it('uses a fresh IV each time: the same password gives different ciphertexts', async () => {
    const { store, rows } = makeStore(ENV);
    await store.save('u1', 't1', PWD, 'g1');
    const first = rows.get('u1')!.secret;
    await store.save('u1', 't1', PWD, 'g1');
    expect(rows.get('u1')!.secret).not.toBe(first);
  });

  it('a value copied to another user, or tampered with, is not readable', async () => {
    const { store, rows } = makeStore(ENV);
    await store.save('u1', 't1', PWD, 'g1');
    rows.set('u2', { ...rows.get('u1')! }); // bound to u1 (AAD)
    await expect(store.read('u2')).resolves.toBeNull();

    const [v, iv, tag, data] = rows.get('u1')!.secret.split('.');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 1;
    rows.set('u1', {
      secret: [v, iv, tag, flipped.toString('base64')].join('.'),
      created_at: new Date(),
    });
    await expect(store.read('u1')).resolves.toBeNull();
  });

  it('a different key cannot read it (key change → reported as not kept)', async () => {
    const a = makeStore(ENV);
    await a.store.save('u1', 't1', PWD, 'g1');
    const b = makeStore({ TEMP_PASSWORD_KEY: 'outra-chave' });
    b.rows.set('u1', a.rows.get('u1')!);
    await expect(b.store.read('u1')).resolves.toBeNull();
  });

  it('remove() deletes the row', async () => {
    const { store, rows } = makeStore(ENV);
    await store.save('u1', 't1', PWD, 'g1');
    await store.remove('u1');
    expect(rows.has('u1')).toBe(false);
    await expect(store.read('u1')).resolves.toBeNull();
  });

  it('without any key it keeps nothing', async () => {
    const { store, query } = makeStore({});
    await store.save('u1', 't1', PWD, 'g1');
    expect(query).not.toHaveBeenCalled();
    await expect(store.read('u1')).resolves.toBeNull();
  });
});
