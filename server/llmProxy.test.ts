import { describe, expect, it, vi } from 'vitest';
import { callLlm, isConfigured, type LlmEnv } from './llmProxy';

const env: LlmEnv = { LITELLM_BASE_URL: 'https://llm.example/v1/', LITELLM_API_KEY: 'k', JUDGE_MODEL: 'sonnet', JUDGE_REASONING_EFFORT: 'high' };
const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });

describe('llm proxy', () => {
  it('knows when it is not configured and refuses to call', async () => {
    expect(isConfigured({})).toBe(false);
    await expect(callLlm({}, { system: 's', user: 'u' })).rejects.toThrow(/not configured/);
  });
  it('posts a chat completion with the key, model and reasoning effort, and returns the text', async () => {
    const f = vi.fn(async () => ok('{"a":1}'));
    expect(await callLlm(env, { system: 's', user: 'u' }, f as unknown as typeof fetch)).toBe('{"a":1}');
    const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer k');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'sonnet', temperature: 0, reasoning_effort: 'high', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] });
  });
  it('retries without reasoning_effort when the proxy rejects it', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('unknown param', { status: 400 })).mockResolvedValueOnce(ok('done'));
    expect(await callLlm(env, { system: 's', user: 'u' }, f as unknown as typeof fetch)).toBe('done');
    expect(JSON.parse((f.mock.calls[1] as unknown as [string, { body: string }])[1].body)).not.toHaveProperty('reasoning_effort');
  });
  it('reports an error status with the proxy message', async () => {
    const f = vi.fn(async () => new Response('bad key', { status: 401 }));
    await expect(callLlm({ ...env, JUDGE_REASONING_EFFORT: '' }, { system: 's', user: 'u' }, f as unknown as typeof fetch)).rejects.toThrow(/401: bad key/);
  });
});

describe('llm proxy with page images', () => {
  it('sends images as image_url parts next to the text', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    await callLlm({ ...env, JUDGE_REASONING_EFFORT: '' }, { system: 's', user: 'u', images: ['data:image/jpeg;base64,AAA'] }, f as unknown as typeof fetch);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { messages: { content: unknown }[] };
    expect(body.messages[1].content).toEqual([{ type: 'text', text: 'u' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } }]);
  });
});
