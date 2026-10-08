import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac, webcrypto } from 'crypto';
import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';
import { SupabaseGuard } from './supabase.guard';

// SEC-03: a local stand-in for Supabase Auth serves the JWKS and /user; tokens
// are signed with ES256 keys generated here, like the project's signing key.

let server: Server;
let base = '';
let jwksHits = 0;
let userHits = 0;
let jwksDown = false;
const knownByServer = new Map<string, { id: string; email: string }>();
let publicJwk: webcrypto.JsonWebKey;
let privateKey: webcrypto.CryptoKey;
let otherKey: webcrypto.CryptoKey;

beforeAll(async () => {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  otherKey = (
    await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    )
  ).privateKey;

  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      jwksHits++;
      if (jwksDown) {
        res.statusCode = 503;
        return res.end('{"msg":"unavailable"}');
      }
      return res.end(
        JSON.stringify({
          keys: [{ ...publicJwk, kid: 'k1', alg: 'ES256', use: 'sig' }],
        }),
      );
    }
    if (req.url === '/auth/v1/user') {
      userHits++;
      const token = (req.headers.authorization ?? '').slice(7);
      const user = knownByServer.get(token);
      if (!user) {
        res.statusCode = 401;
        return res.end('{"code":401,"msg":"invalid JWT"}');
      }
      return res.end(JSON.stringify({ ...user, aud: 'authenticated' }));
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  jwksHits = 0;
  userHits = 0;
  jwksDown = false;
  knownByServer.clear();
});

const b64 = (v: string | Uint8Array) => Buffer.from(v).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

async function es256(
  claims: Record<string, unknown>,
  { kid = 'k1', key = privateKey } = {},
) {
  const head = b64(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }));
  const body = b64(
    JSON.stringify({
      sub: 'u-1',
      email: 'ana@x.dev',
      aud: 'authenticated',
      role: 'authenticated',
      iss: `${base}/auth/v1`,
      exp: now() + 3600,
      ...claims,
    }),
  );
  const sig = await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(`${head}.${body}`),
  );
  return `${head}.${body}.${b64(new Uint8Array(sig))}`;
}

function hs256(claims: Record<string, unknown>) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(
    JSON.stringify({
      sub: 'u-9',
      aud: 'authenticated',
      iss: `${base}/auth/v1`,
      exp: now() + 3600,
      ...claims,
    }),
  );
  const sig = createHmac('sha256', 'legacy').update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64(sig)}`;
}

// supabase-js keeps the JWKS cache per project host: `url` lets a test start
// with a cold cache (localhost instead of 127.0.0.1)
function guard(url = base) {
  const config = {
    getOrThrow: (key: string) =>
      key === 'SUPABASE_URL' ? `${url}/` : 'anon-key',
  } as unknown as ConfigService;
  const reflector = {
    getAllAndOverride: () => false,
  } as unknown as Reflector;
  return new SupabaseGuard(config, reflector);
}

function ctx(token?: string) {
  const req: { headers: { authorization?: string }; user?: unknown } = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { req, context };
}

const pass = async (g: SupabaseGuard, token?: string) => {
  const { req, context } = ctx(token);
  await expect(g.canActivate(context)).resolves.toBe(true);
  return req.user;
};
const reject = (g: SupabaseGuard, token?: string) =>
  expect(g.canActivate(ctx(token).context)).rejects.toBeInstanceOf(
    UnauthorizedException,
  );

describe('SEC-03: JWT verified locally (JWKS), with getUser fallback', () => {
  it('accepts a valid ES256 token without calling Supabase per request', async () => {
    const g = guard();
    const token = await es256({});
    expect(await pass(g, token)).toEqual({
      externalId: 'u-1',
      email: 'ana@x.dev',
    });
    await pass(g, token);
    await pass(g, await es256({ sub: 'u-2', email: 'bia@x.dev' }));
    expect(jwksHits).toBe(1); // keys cached
    expect(userHits).toBe(0); // no round-trip to /user
  });

  it('auth takes under 5 ms once the keys are cached', async () => {
    const g = guard();
    const token = await es256({});
    await pass(g, token); // warms the JWKS cache
    const times: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      await g.canActivate(ctx(token).context);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    expect(median).toBeLessThan(5);
  });

  it('rejects a tampered token, an expired one, wrong aud or wrong iss — without asking /user', async () => {
    const g = guard();
    const valid = await es256({});
    const [h, , s] = valid.split('.');
    const forged = `${h}.${b64(JSON.stringify({ sub: 'admin', aud: 'authenticated', iss: `${base}/auth/v1`, exp: now() + 3600 }))}.${s}`;
    await reject(g, forged);
    await reject(g, await es256({ exp: now() - 10 }));
    await reject(g, await es256({ aud: 'anon' }));
    await reject(
      g,
      await es256({ iss: 'https://outro-projeto.supabase.co/auth/v1' }),
    );
    await reject(g, 'nao-e-um-jwt');
    await reject(g, undefined);
    expect(userHits).toBe(0);
  });

  it('a key that is not in the JWKS falls back to getUser', async () => {
    const g = guard();
    const rotated = await es256(
      { sub: 'u-3', email: 'caio@x.dev' },
      { kid: 'k2', key: otherKey },
    );
    await reject(g, rotated); // Supabase does not know it either
    knownByServer.set(rotated, { id: 'u-3', email: 'caio@x.dev' });
    expect(await pass(g, rotated)).toEqual({
      externalId: 'u-3',
      email: 'caio@x.dev',
    });
    expect(userHits).toBe(2);
  });

  it('JWKS unavailable: falls back to getUser', async () => {
    jwksDown = true;
    const cold = base.replace('127.0.0.1', 'localhost');
    const g = guard(cold);
    const token = await es256({ iss: `${cold}/auth/v1` });
    knownByServer.set(token, { id: 'u-1', email: 'ana@x.dev' });
    expect(await pass(g, token)).toEqual({
      externalId: 'u-1',
      email: 'ana@x.dev',
    });
    expect(userHits).toBe(1);
  });

  it('HS256 (legacy secret) tokens are validated by getUser', async () => {
    const g = guard();
    const token = hs256({ email: 'leg@x.dev' });
    await reject(g, token);
    knownByServer.set(token, { id: 'u-9', email: 'leg@x.dev' });
    expect(await pass(g, token)).toEqual({
      externalId: 'u-9',
      email: 'leg@x.dev',
    });
  });
});
