import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// Google sign-in for the production server. The browser gets a Google ID token; the server verifies it, checks the email against an
// allowlist, and keeps the user signed in with a signed cookie. Everything except /login and /api/auth/* needs that cookie.
// Off unless GOOGLE_CLIENT_ID is set, so local development and an open deployment are unaffected.

// Only what the server hands us (see chatProxy): no Node types leak into the browser project.
interface IncomingMessage {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  setEncoding(encoding: string): void;
  on(event: 'data' | 'end' | 'error' | 'close', listener: (arg: never) => void): void;
}
interface ServerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export interface AuthEnv {
  /** The Google OAuth client id (a public value). Setting it turns sign-in on. */
  GOOGLE_CLIENT_ID?: string;
  /** Comma-separated email domains that may sign in, e.g. "example.com". Exact match, no subdomains. */
  ALLOWED_DOMAINS?: string;
  /** Comma-separated individual emails that may sign in in addition to the domains. */
  ALLOWED_EMAILS?: string;
  /** At least 32 random characters; signs the session cookie. */
  SESSION_SECRET?: string;
  /** How long a sign-in lasts. Default 12. */
  SESSION_HOURS?: string;
}

/** The header the rest of the server reads the signed-in user from (see chatProxy's AUTH_HEADER). */
export const USER_HEADER = 'x-forwarded-email';
export const SESSION_COOKIE = 'ui_session';

const MAX_BODY = 16 * 1024;
const HOUR = 3_600_000;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

export interface Allowlist {
  domains: string[];
  emails: string[];
}

const list = (v: string | undefined): string[] =>
  (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function parseAllowlist(env: AuthEnv): Allowlist {
  return { domains: list(env.ALLOWED_DOMAINS).map((d) => d.replace(/^@/, '')), emails: list(env.ALLOWED_EMAILS) };
}

/** A listed email, or an address on a listed domain (exact match: sub.example.com is not example.com). Empty lists allow nobody. */
export function isAllowed(email: string, allow: Allowlist): boolean {
  const e = email.trim().toLowerCase();
  const parts = e.split('@');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return false;
  return allow.emails.includes(e) || allow.domains.includes(parts[1]);
}

export const authEnabled = (env: AuthEnv): boolean => Boolean(env.GOOGLE_CLIENT_ID?.trim());

/** What is wrong with the settings when sign-in is on, or null. */
export function authConfigProblem(env: AuthEnv): string | null {
  if (!authEnabled(env)) return null;
  if ((env.SESSION_SECRET ?? '').length < 32) return 'SESSION_SECRET must be at least 32 characters when GOOGLE_CLIENT_ID is set.';
  const a = parseAllowlist(env);
  if (a.domains.length === 0 && a.emails.length === 0) return 'Set ALLOWED_DOMAINS (or ALLOWED_EMAILS): with neither, nobody can sign in.';
  return null;
}

const sign = (payload: string, secret: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

export function signSession(email: string, secret: string, now: number, ttlMs: number): string {
  const payload = Buffer.from(JSON.stringify({ e: email, x: now + ttlMs })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The signed-in email, or null if the token is malformed, forged, or expired. */
export function verifySession(token: string, secret: string, now: number): string | null {
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null;
  const [payload, sig] = parts;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e?: unknown; x?: unknown };
    return typeof e === 'string' && typeof x === 'number' && now <= x ? e : null;
  } catch {
    return null;
  }
}

export type IdTokenVerifier = (idToken: string) => Promise<{ email: string; emailVerified: boolean }>;

/** Verifies a Google ID token: signature (Google's keys), issuer, audience (our client id) and expiry. */
export function googleVerifier(clientId: string, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_CERTS))): IdTokenVerifier {
  return async (idToken) => {
    const { payload } = await jwtVerify(idToken, keys, { issuer: GOOGLE_ISSUERS, audience: clientId, algorithms: ['RS256'] });
    if (typeof payload.email !== 'string' || payload.email === '') throw new Error('Token has no email');
    return { email: payload.email, emailVerified: payload.email_verified === true || payload.email_verified === 'true' };
  };
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function loginPage(clientId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>UI Builder · Sign in</title>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f7fa; color: #2f3b4a; font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif; }
  main { background: #fff; border-radius: 8px; box-shadow: 0 0 12px rgba(16,22,26,.08); padding: 40px 48px; text-align: center; max-width: 420px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
  p { color: #7b8794; margin: 0 0 24px; }
  #btn { display: flex; justify-content: center; min-height: 44px; }
  #msg { margin-top: 16px; color: #e02f2f; min-height: 1.5em; }
</style>
</head>
<body>
<main id="signin" data-client-id="${escapeHtml(clientId)}">
  <h1>UI Builder</h1>
  <p>Sign in with your Google account to continue.</p>
  <div id="btn"></div>
  <div id="msg" role="alert"></div>
</main>
<script>
  var root = document.getElementById('signin');
  var msg = document.getElementById('msg');
  function onCredential(r) {
    msg.textContent = 'Signing in…';
    fetch('/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: r.credential }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (o) { if (o.ok) location.replace('/'); else msg.textContent = o.j.error || 'Sign-in failed'; })
      .catch(function () { msg.textContent = 'Could not reach the server'; });
  }
  function init() {
    if (!window.google || !google.accounts) return void setTimeout(init, 100);
    google.accounts.id.initialize({ client_id: root.dataset.clientId, callback: onCredential });
    google.accounts.id.renderButton(document.getElementById('btn'), { theme: 'outline', size: 'large' });
  }
  init();
</script>
</body>
</html>`;
}

const header = (req: IncomingMessage, name: string): string => {
  const v = req.headers?.[name];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
};

function cookieValue(req: IncomingMessage, name: string): string {
  for (const part of header(req, 'cookie').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', ((c: string) => {
      text += c;
      if (text.length > MAX_BODY) reject(new Error('Request too large'));
    }) as never);
    req.on('end', (() => resolve(text)) as never);
    req.on('error', (() => reject(new Error('Could not read the request'))) as never);
  });

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, to: string): void {
  res.statusCode = 302;
  res.setHeader('location', to);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

export function authMiddleware(env: AuthEnv, verify?: IdTokenVerifier, now: () => number = Date.now) {
  const enabled = authEnabled(env);
  const clientId = (env.GOOGLE_CLIENT_ID ?? '').trim();
  const secret = env.SESSION_SECRET ?? '';
  const allow = parseAllowlist(env);
  const hours = Number(env.SESSION_HOURS);
  const ttlMs = (Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) : 12) * HOUR;
  const verifyToken = enabled ? (verify ?? googleVerifier(clientId)) : undefined;

  /** The signed-in email, re-checked against the allowlist so removing a domain locks existing sessions out. */
  const sessionEmail = (req: IncomingMessage): string | null => {
    const email = verifySession(cookieValue(req, SESSION_COOKIE), secret, now());
    return email !== null && isAllowed(email, allow) ? email : null;
  };

  const setCookie = (req: IncomingMessage, res: ServerResponse, value: string, maxAgeSec: number): void => {
    const secure = header(req, 'x-forwarded-proto').split(',')[0].trim() === 'https';
    res.setHeader('set-cookie', `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
  };

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (!enabled || !verifyToken) return next();
    // Never trust a user header sent by the caller; only the verified session may set it.
    if (req.headers) delete req.headers[USER_HEADER];
    const path = (req.url ?? '/').split('?')[0];
    const method = (req.method ?? 'GET').toUpperCase();
    const email = sessionEmail(req);

    if (path === '/login' && method === 'GET') {
      if (email) return redirect(res, '/');
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      return void res.end(loginPage(clientId));
    }

    if (path === '/api/auth/google' && method === 'POST') {
      let credential: unknown;
      try {
        credential = (JSON.parse(await readBody(req)) as { credential?: unknown }).credential;
      } catch {
        return json(res, 400, { error: 'Bad request.' });
      }
      if (typeof credential !== 'string' || credential === '') return json(res, 400, { error: 'Bad request.' });
      let who: { email: string; emailVerified: boolean };
      try {
        who = await verifyToken(credential);
      } catch {
        return json(res, 401, { error: 'Google sign-in could not be verified.' });
      }
      if (!who.emailVerified) return json(res, 403, { error: 'Your Google email is not verified.' });
      if (!isAllowed(who.email, allow)) return json(res, 403, { error: 'This account is not allowed to sign in.' });
      setCookie(req, res, signSession(who.email, secret, now(), ttlMs), Math.floor(ttlMs / 1000));
      return json(res, 200, { email: who.email });
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      setCookie(req, res, '', 0);
      return json(res, 200, { ok: true });
    }

    if (path === '/api/auth/me' && method === 'GET') return email ? json(res, 200, { email }) : json(res, 401, { error: 'Sign in first.' });

    if (email) {
      if (req.headers) req.headers[USER_HEADER] = email;
      return next();
    }
    if (path.startsWith('/api/')) return json(res, 401, { error: 'Sign in first.' });
    if (method === 'GET' || method === 'HEAD') return redirect(res, '/login');
    return json(res, 401, { error: 'Sign in first.' });
  };
}
