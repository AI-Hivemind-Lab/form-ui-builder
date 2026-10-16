import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  authConfigProblem, authEnabled, authMiddleware, googleVerifier, isAllowed, parseAllowlist, SESSION_COOKIE, signSession, USER_HEADER, verifySession,
  type IdTokenVerifier,
} from './auth';

const SECRET = 'x'.repeat(32);
const CLIENT_ID = 'cid.apps.googleusercontent.com';
const base = { GOOGLE_CLIENT_ID: CLIENT_ID, ALLOWED_DOMAINS: 'example.com', SESSION_SECRET: SECRET };
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  const handlers: Record<string, (arg: never) => void> = {};
  return {
    url: path, method, headers,
    setEncoding: () => {},
    on(event: string, cb: (arg: never) => void) {
      handlers[event] = cb;
      if (event === 'end') setTimeout(() => { if (body !== undefined) handlers.data?.((typeof body === 'string' ? body : JSON.stringify(body)) as never); cb(undefined as never); }, 0);
    },
  };
}
function response() {
  const out = { status: 0, headers: {} as Record<string, string>, body: '', ended: false };
  return {
    out,
    res: {
      get statusCode() { return out.status; }, set statusCode(v: number) { out.status = v; },
      setHeader: (k: string, v: string) => { out.headers[k.toLowerCase()] = v; },
      write: () => true,
      end: (b?: string) => { if (b) out.body += b; out.ended = true; },
    },
  };
}
const verifier: IdTokenVerifier = async (t) => {
  if (t === 'good') return { email: 'pat@example.com', emailVerified: true };
  if (t === 'unverified') return { email: 'pat@example.com', emailVerified: false };
  if (t === 'outsider') return { email: 'x@evil.io', emailVerified: true };
  throw new Error('bad token');
};
const cookieFor = (email = 'pat@example.com', secret = SECRET, now = NOW, ttl = 12 * HOUR) => `${SESSION_COOKIE}=${signSession(email, secret, now, ttl)}`;

async function run(env: Record<string, string>, path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const mw = authMiddleware(env, verifier, () => NOW);
  const req = request(path, opts.method ?? 'GET', opts.body, opts.headers ?? {});
  const { res, out } = response();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  return { out, req, nexted, json: () => JSON.parse(out.body || 'null') };
}

describe('allowlist', () => {
  it('parses domains and emails: trimmed, lower-cased, @ stripped, empties dropped', () => {
    expect(parseAllowlist({ ALLOWED_DOMAINS: ' Example.com, @corp.io ,,', ALLOWED_EMAILS: ' Me@X.com ' })).toEqual({ domains: ['example.com', 'corp.io'], emails: ['me@x.com'] });
  });
  it('allows an exact domain, any case, and listed emails', () => {
    const l = parseAllowlist({ ALLOWED_DOMAINS: 'example.com', ALLOWED_EMAILS: 'guest@other.org' });
    expect(isAllowed('pat@EXAMPLE.com', l)).toBe(true);
    expect(isAllowed(' pat@example.com ', l)).toBe(true);
    expect(isAllowed('Guest@Other.org', l)).toBe(true);
  });
  it.each(['pat@sub.example.com', 'pat@example.com.evil.io', 'pat@evil.io@example.com', 'a@b@example.com', '@example.com', 'pat@', '', 'example.com', 'pat@evil.io'])(
    'rejects %j',
    (email) => expect(isAllowed(email, parseAllowlist({ ALLOWED_DOMAINS: 'example.com' }))).toBe(false),
  );
  it('fails closed on an empty allowlist', () => {
    expect(isAllowed('pat@example.com', parseAllowlist({}))).toBe(false);
  });
});

describe('sessions', () => {
  it('round-trips the email', () => {
    expect(verifySession(signSession('pat@example.com', SECRET, NOW, HOUR), SECRET, NOW + 1000)).toBe('pat@example.com');
  });
  it('rejects a wrong secret, a tampered payload, a tampered signature, and an expired token', () => {
    const t = signSession('pat@example.com', SECRET, NOW, HOUR);
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ e: 'boss@example.com', x: NOW + HOUR })).toString('base64url');
    expect(verifySession(t, 'y'.repeat(32), NOW)).toBeNull();
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifySession(`${payload}.${sig.slice(0, -2)}AA`, SECRET, NOW)).toBeNull();
    expect(verifySession(t, SECRET, NOW + HOUR + 1)).toBeNull();
  });
  it.each(['', 'abc', 'a.b.c', '.', 'a.', '.b', 'e30.e30'])('rejects garbage %j', (t) => expect(verifySession(t, SECRET, NOW)).toBeNull());
});

describe('configuration', () => {
  it('is off without a client id and needs no settings then', () => {
    expect(authEnabled({})).toBe(false);
    expect(authConfigProblem({})).toBeNull();
    expect(authEnabled(base)).toBe(true);
  });
  it('flags a short secret and a missing allowlist when on', () => {
    expect(authConfigProblem({ ...base, SESSION_SECRET: 'short' })).toMatch(/SESSION_SECRET/);
    expect(authConfigProblem({ GOOGLE_CLIENT_ID: CLIENT_ID, SESSION_SECRET: SECRET })).toMatch(/ALLOWED_DOMAINS/);
    expect(authConfigProblem(base)).toBeNull();
    expect(authConfigProblem({ GOOGLE_CLIENT_ID: CLIENT_ID, SESSION_SECRET: SECRET, ALLOWED_EMAILS: 'a@b.co' })).toBeNull();
  });
});

describe('googleVerifier', () => {
  async function setup() {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const keys = createLocalJWKSet({ keys: [jwk] });
    const sign = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: string | number; key?: typeof privateKey } = {}) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(o.iss ?? 'https://accounts.google.com').setAudience(o.aud ?? CLIENT_ID).setIssuedAt().setExpirationTime(o.exp ?? '1h').sign(o.key ?? privateKey);
    return { keys, sign };
  }
  it('accepts a valid token and reports email + verified flag', async () => {
    const { keys, sign } = await setup();
    const v = googleVerifier(CLIENT_ID, keys);
    expect(await v(await sign({ email: 'pat@example.com', email_verified: true }))).toEqual({ email: 'pat@example.com', emailVerified: true });
    expect(await v(await sign({ email: 'pat@example.com', email_verified: false }, { iss: 'accounts.google.com' }))).toEqual({ email: 'pat@example.com', emailVerified: false });
  });
  it('rejects a wrong audience, wrong issuer, expired token, foreign signature and a token with no email', async () => {
    const { keys, sign } = await setup();
    const v = googleVerifier(CLIENT_ID, keys);
    const other = await generateKeyPair('RS256');
    await expect(v(await sign({ email: 'a@b.co', email_verified: true }, { aud: 'someone-else' }))).rejects.toThrow();
    await expect(v(await sign({ email: 'a@b.co', email_verified: true }, { iss: 'https://evil.example' }))).rejects.toThrow();
    await expect(v(await sign({ email: 'a@b.co', email_verified: true }, { exp: Math.floor(Date.now() / 1000) - 3600 }))).rejects.toThrow();
    await expect(v(await sign({ email: 'a@b.co', email_verified: true }, { key: other.privateKey }))).rejects.toThrow();
    await expect(v(await sign({ email_verified: true }))).rejects.toThrow(/email/);
    await expect(v('not.a.jwt')).rejects.toThrow();
  });
});

describe('authMiddleware', () => {
  it('does nothing when no client id is set', async () => {
    const r = await run({}, '/anything');
    expect(r.nexted).toBe(true);
    expect(r.out.ended).toBe(false);
  });

  it('sends signed-out page requests to /login and refuses signed-out API calls', async () => {
    for (const path of ['/', '/assets/app.js', '/some/route']) {
      const r = await run(base, path);
      expect(r.out.status).toBe(302);
      expect(r.out.headers.location).toBe('/login');
      expect(r.nexted).toBe(false);
    }
    for (const [path, method] of [['/api/llm', 'POST'], ['/api/chat/status', 'GET'], ['/api/chat', 'POST'], ['/other', 'POST']] as const) {
      const r = await run(base, path, { method });
      expect(r.out.status).toBe(401);
      expect(r.nexted).toBe(false);
    }
  });

  it('serves the login page with the client id, escaped, and never caches it', async () => {
    const r = await run(base, '/login');
    expect(r.out.status).toBe(200);
    expect(r.out.headers['content-type']).toMatch(/text\/html/);
    expect(r.out.headers['cache-control']).toBe('no-store');
    expect(r.out.body).toContain(CLIENT_ID);
    expect(r.out.body).toContain('accounts.google.com/gsi/client');
    const hostile = await run({ ...base, GOOGLE_CLIENT_ID: '"><script>alert(1)</script>' }, '/login');
    expect(hostile.out.body).not.toContain('<script>alert(1)</script>');
  });

  it('redirects a signed-in visitor away from /login', async () => {
    const r = await run(base, '/login', { headers: { cookie: cookieFor() } });
    expect(r.out.status).toBe(302);
    expect(r.out.headers.location).toBe('/');
  });

  it('signs an allowed Google user in with an HttpOnly session cookie', async () => {
    const r = await run(base, '/api/auth/google', { method: 'POST', body: { credential: 'good' } });
    expect(r.out.status).toBe(200);
    expect(r.json()).toEqual({ email: 'pat@example.com' });
    const cookie = r.out.headers['set-cookie'];
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/);
    expect(verifySession(cookie.split(';')[0].split('=')[1], SECRET, NOW + 1000)).toBe('pat@example.com');
  });

  it('adds Secure over https', async () => {
    const r = await run(base, '/api/auth/google', { method: 'POST', body: { credential: 'good' }, headers: { 'x-forwarded-proto': 'https' } });
    expect(r.out.headers['set-cookie']).toMatch(/Secure/);
  });

  it('refuses unverified emails, outsiders, bad tokens and malformed bodies, without a cookie', async () => {
    const cases: [unknown, number][] = [[{ credential: 'unverified' }, 403], [{ credential: 'outsider' }, 403], [{ credential: 'garbage' }, 401], [{}, 400], ['{oops', 400], [{ credential: 5 }, 400]];
    for (const [body, status] of cases) {
      const r = await run(base, '/api/auth/google', { method: 'POST', body });
      expect(r.out.status).toBe(status);
      expect(r.out.headers['set-cookie']).toBeUndefined();
    }
  });

  it('fails closed: a client id with no allowlist lets nobody in', async () => {
    const r = await run({ GOOGLE_CLIENT_ID: CLIENT_ID, SESSION_SECRET: SECRET }, '/api/auth/google', { method: 'POST', body: { credential: 'good' } });
    expect(r.out.status).toBe(403);
  });

  it('lets a valid session through and stamps the verified email, replacing any spoofed header', async () => {
    const r = await run(base, '/api/chat', { method: 'POST', headers: { cookie: `a=b; ${cookieFor()}; c=d`, [USER_HEADER]: 'boss@example.com' } });
    expect(r.nexted).toBe(true);
    expect(r.req.headers[USER_HEADER]).toBe('pat@example.com');
  });

  it('does not let a spoofed user header stand in for a session', async () => {
    const r = await run(base, '/api/chat/status', { headers: { [USER_HEADER]: 'pat@example.com' } });
    expect(r.out.status).toBe(401);
    expect(r.nexted).toBe(false);
  });

  it('ignores expired sessions and sessions signed with another secret', async () => {
    expect((await run(base, '/api/chat/status', { headers: { cookie: cookieFor('pat@example.com', SECRET, NOW - 13 * HOUR) } })).out.status).toBe(401);
    expect((await run(base, '/api/chat/status', { headers: { cookie: cookieFor('pat@example.com', 'z'.repeat(32)) } })).out.status).toBe(401);
  });

  it('re-checks the allowlist on every request, so removing a domain locks existing sessions out', async () => {
    const r = await run({ ...base, ALLOWED_DOMAINS: 'other.org' }, '/api/chat/status', { headers: { cookie: cookieFor() } });
    expect(r.out.status).toBe(401);
  });

  it('reports who is signed in and signs out', async () => {
    const me = await run(base, '/api/auth/me', { headers: { cookie: cookieFor() } });
    expect(me.out.status).toBe(200);
    expect(me.json()).toEqual({ email: 'pat@example.com' });
    expect((await run(base, '/api/auth/me')).out.status).toBe(401);
    const out = await run(base, '/api/auth/logout', { method: 'POST', headers: { cookie: cookieFor() } });
    expect(out.out.status).toBe(200);
    expect(out.out.headers['set-cookie']).toMatch(/Max-Age=0/);
  });
});
