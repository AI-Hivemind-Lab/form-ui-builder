/** Who is signed in, read from the server's /api/auth/me answer. 'off' means Google sign-in is not enabled on this server. */
export type SessionState = { kind: 'off' } | { kind: 'signed-out' } | { kind: 'signed-in'; email: string };

const OFF: SessionState = { kind: 'off' };

/**
 * Only our own JSON answers count. The open site (and the dev server) answer unknown /api paths with the app page, and another proxy's
 * 401 would be HTML or another shape; both read as "off" so the app never shows a sign-out button or bounces to /login by mistake.
 */
export function parseMe(status: number, contentType: string, body: string): SessionState {
  if (!/json/i.test(contentType)) return OFF;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return OFF;
  }
  if (typeof data !== 'object' || data === null) return OFF;
  const o = data as Record<string, unknown>;
  if (status === 200 && typeof o.email === 'string' && o.email !== '') return { kind: 'signed-in', email: o.email };
  if (status === 401 && typeof o.error === 'string') return { kind: 'signed-out' };
  return OFF;
}
