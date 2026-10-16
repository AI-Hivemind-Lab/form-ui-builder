import { describe, expect, it } from 'vitest';
import { parseMe } from './session';

const JSON_TYPE = 'application/json';

describe('parseMe: who is signed in, from the /api/auth/me response', () => {
  it('reads the email when signed in', () => {
    expect(parseMe(200, JSON_TYPE, '{"email":"pat@example.com"}')).toEqual({ kind: 'signed-in', email: 'pat@example.com' });
    expect(parseMe(200, 'application/json; charset=utf-8', '{"email":"pat@example.com"}')).toEqual({ kind: 'signed-in', email: 'pat@example.com' });
  });

  it('is signed out on the server\'s JSON 401, so an expired session is noticed', () => {
    expect(parseMe(401, JSON_TYPE, '{"error":"Sign in first."}')).toEqual({ kind: 'signed-out' });
  });

  it('is "off" when sign-in is not enabled: the open site answers with the app page, not JSON', () => {
    expect(parseMe(200, 'text/html; charset=utf-8', '<!doctype html><html></html>')).toEqual({ kind: 'off' });
    expect(parseMe(404, 'text/plain', 'Not found')).toEqual({ kind: 'off' });
  });

  it('is "off" for a 401 that is not ours (another proxy), so the app never bounces to /login by mistake', () => {
    expect(parseMe(401, 'text/html', '<html>Unauthorized</html>')).toEqual({ kind: 'off' });
    expect(parseMe(401, JSON_TYPE, '{"message":"nope"}')).toEqual({ kind: 'off' });
  });

  it.each([
    ['empty email', '{"email":""}'],
    ['no email', '{}'],
    ['non-string email', '{"email":5}'],
    ['not an object', '"pat@example.com"'],
    ['null', 'null'],
    ['malformed JSON', '{oops'],
    ['empty body', ''],
  ])('is "off" for a 200 with %s', (_label, body) => {
    expect(parseMe(200, JSON_TYPE, body)).toEqual({ kind: 'off' });
  });

  it('is "off" for server errors', () => {
    expect(parseMe(500, JSON_TYPE, '{"error":"boom"}')).toEqual({ kind: 'off' });
  });
});
