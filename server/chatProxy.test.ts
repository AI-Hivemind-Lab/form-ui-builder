import { describe, expect, it, vi } from 'vitest';
import { chatMiddleware, chatRequestProblem } from './chatProxy';

const env = { LITELLM_BASE_URL: 'https://llm.example/v1', LITELLM_API_KEY: 'sk-secret', JUDGE_MODEL: 'judge-model' };

function request(path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const handlers: Record<string, (arg: never) => void> = {};
  return {
    url: path, method, headers,
    setEncoding: () => {},
    on(event: string, cb: (arg: never) => void) {
      handlers[event] = cb;
      if (event === 'end') setTimeout(() => { if (body !== undefined) handlers.data?.(JSON.stringify(body) as never); cb(undefined as never); }, 0);
    },
  };
}
function response() {
  const out = { status: 0, headers: {} as Record<string, string>, chunks: [] as string[], ended: false };
  return {
    out,
    res: {
      get statusCode() { return out.status; }, set statusCode(v: number) { out.status = v; },
      setHeader: (k: string, v: string) => { out.headers[k.toLowerCase()] = v; },
      write: (c: string | Uint8Array) => { out.chunks.push(typeof c === 'string' ? c : new TextDecoder().decode(c)); return true; },
      end: (b?: string) => { if (b) out.chunks.push(b); out.ended = true; },
    },
  };
}
const sse = (...events: string[]) => new ReadableStream<Uint8Array>({ start(c) { events.forEach((e) => c.enqueue(new TextEncoder().encode(e))); c.close(); } });
const wait = () => new Promise((r) => setTimeout(r, 20));

describe('chat request check', () => {
  it('needs the system text, messages with roles, and a short list of tools', () => {
    expect(chatRequestProblem({ system: 's', messages: [{ role: 'user', content: 'hi' }] })).toBeNull();
    expect(chatRequestProblem({ messages: [{ role: 'user' }] })).toMatch(/system/);
    expect(chatRequestProblem({ system: 's', messages: [] })).toMatch(/messages/);
    expect(chatRequestProblem({ system: 's', messages: [{ content: 'x' }] })).toMatch(/role/);
    expect(chatRequestProblem({ system: 's', messages: [{ role: 'user' }], tools: new Array(41).fill({}) })).toMatch(/tools/);
  });
});

describe('POST /api/chat', () => {
  it('sends the conversation to the model with the key it holds, and streams the answer back unchanged', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, body: sse('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n', 'data: [DONE]\n\n') });
    const { res, out } = response();
    await chatMiddleware(env, fetchFn as unknown as typeof fetch)(request('/api/chat', 'POST', { system: 'You are helpful', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'x' } }] }), res, () => {});
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toMatch(/text\/event-stream/);
    expect(out.chunks.join('')).toBe('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n');
    const [url, init] = fetchFn.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer sk-secret');
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ model: 'judge-model', stream: true, tool_choice: 'auto' });
    expect(sent.messages).toEqual([{ role: 'system', content: 'You are helpful' }, { role: 'user', content: 'hi' }]);
    expect(sent.reasoning_effort).toBeUndefined(); // normal effort
  });

  it('uses the assistant\'s own model and effort when they are set', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, body: sse('data: [DONE]\n\n') });
    await chatMiddleware({ ...env, CHAT_MODEL: 'chat-model', CHAT_REASONING_EFFORT: 'low' }, fetchFn as unknown as typeof fetch)(request('/api/chat', 'POST', { system: 's', messages: [{ role: 'user', content: 'x' }] }), response().res, () => {});
    expect(JSON.parse((fetchFn.mock.calls[0][1] as { body: string }).body)).toMatchObject({ model: 'chat-model', reasoning_effort: 'low' });
  });

  it('answers 502 with the reason when the model service refuses', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited', body: null });
    const { res, out } = response();
    await chatMiddleware(env, fetchFn as unknown as typeof fetch)(request('/api/chat', 'POST', { system: 's', messages: [{ role: 'user', content: 'x' }] }), res, () => {});
    expect(out.status).toBe(502);
    expect(out.chunks.join('')).toContain('429');
  });

  it('refuses a bad request, an unconfigured service, and passes other paths on', async () => {
    const bad = response();
    await chatMiddleware(env)(request('/api/chat', 'POST', { messages: [] }), bad.res, () => {});
    expect(bad.out.status).toBe(400);
    const off = response();
    await chatMiddleware({})(request('/api/chat', 'POST', { system: 's', messages: [{ role: 'user', content: 'x' }] }), off.res, () => {});
    expect(off.out.status).toBe(503);
    const next = vi.fn();
    await chatMiddleware(env)(request('/something', 'GET'), response().res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('behind single sign-on', () => {
  const sso = { ...env, AUTH_HEADER: 'X-Forwarded-Email' };
  it('refuses a request without the signed-in user, and reports who is signed in', async () => {
    const anon = response();
    await chatMiddleware(sso)(request('/api/chat/status', 'GET'), anon.res, () => {});
    expect(anon.out.status).toBe(401);
    const who = response();
    await chatMiddleware(sso)(request('/api/chat/status', 'GET', undefined, { 'x-forwarded-email': 'pat@example.com' }), who.res, () => {});
    expect(JSON.parse(who.out.chunks.join(''))).toMatchObject({ configured: true, user: 'pat@example.com' });
    await wait();
  });
});
