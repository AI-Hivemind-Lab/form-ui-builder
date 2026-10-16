import { isConfigured, type LlmEnv } from './llmProxy';

// Only what the server hands us (see llmProxy): no Node types in the browser project.
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
  write(chunk: string | Uint8Array): boolean;
  end(body?: string): void;
  flushHeaders?: () => void;
}

export interface ChatEnv extends LlmEnv {
  /** The model for the assistant; defaults to JUDGE_MODEL (Sonnet 5.5). */
  CHAT_MODEL?: string;
  /** Optional reasoning_effort for the assistant. Unset = the model's normal effort. */
  CHAT_REASONING_EFFORT?: string;
  /**
   * When the app sits behind single sign-on (for example Dokploy's forward auth in front of Anduin SSO), the name of the header that
   * carries the signed-in user's email. If set, a request without it is refused.
   */
  AUTH_HEADER?: string;
}

const MAX_BODY = 12 * 1024 * 1024; // page images are sent as data URLs
const MAX_SYSTEM = 80_000;
const MAX_TOOLS = 40;

export const chatModel = (env: ChatEnv): string | undefined => env.CHAT_MODEL?.trim() || env.JUDGE_MODEL;

const header = (req: IncomingMessage, name: string): string => {
  const v = req.headers?.[name.toLowerCase()];
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
};

/** Who is signed in, when the app is behind single sign-on; '' when it is not asked for. */
export const userOf = (env: ChatEnv, req: IncomingMessage): string => (env.AUTH_HEADER ? header(req, env.AUTH_HEADER) : '');

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', ((c: string) => {
      text += c;
      if (text.length > MAX_BODY) reject(new Error('too large'));
    }) as (arg: never) => void);
    req.on('end', (() => resolve(text)) as (arg: never) => void);
    req.on('error', reject as (arg: never) => void);
  });

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

interface ChatRequest {
  system: string;
  messages: unknown[];
  tools?: unknown[];
}

/** Check the request and say what is wrong with it, or null. */
export function chatRequestProblem(body: Partial<ChatRequest>): string | null {
  if (typeof body.system !== 'string' || body.system === '') return 'system text is required';
  if (body.system.length > MAX_SYSTEM) return 'system text is too long';
  if (!Array.isArray(body.messages) || body.messages.length === 0) return 'messages are required';
  if (body.messages.some((m) => typeof m !== 'object' || m === null || typeof (m as { role?: unknown }).role !== 'string')) return 'every message needs a role';
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > MAX_TOOLS)) return 'tools must be a short list';
  return null;
}

/**
 * The assistant's line to the model: POST /api/chat streams one completion back (server-sent events in the OpenAI format, tool calls
 * included). The tools run in the browser, which sends their results with the next request, so this only holds the key and passes
 * the stream through. GET /api/chat/status says whether it is set up and who is signed in.
 */
export function chatMiddleware(env: ChatEnv, fetchFn: typeof fetch = fetch) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/api/chat' && path !== '/api/chat/status') return next();
    const user = userOf(env, req);
    if (env.AUTH_HEADER && user === '') return json(res, 401, { error: 'Sign in first.' });
    if (path === '/api/chat/status') return json(res, 200, { configured: isConfigured(env), model: chatModel(env) ?? null, user: user || null });
    if (req.method !== 'POST') return next();
    if (!isConfigured(env)) return json(res, 503, { error: 'The AI service is not configured. Set LITELLM_BASE_URL, LITELLM_API_KEY and JUDGE_MODEL.' });

    let body: Partial<ChatRequest>;
    try {
      body = JSON.parse(await readBody(req)) as Partial<ChatRequest>;
    } catch (e) {
      return json(res, e instanceof Error && e.message === 'too large' ? 413 : 400, { error: e instanceof Error && e.message === 'too large' ? 'The request is too large.' : 'The request is not valid JSON.' });
    }
    const problem = chatRequestProblem(body);
    if (problem) return json(res, 400, { error: problem });

    const effort = env.CHAT_REASONING_EFFORT?.trim();
    const upstream = {
      model: chatModel(env),
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 4096,
      messages: [{ role: 'system', content: body.system }, ...(body.messages as unknown[])],
      ...(body.tools && body.tools.length > 0 ? { tools: body.tools, tool_choice: 'auto' } : {}),
      ...(effort ? { reasoning_effort: effort } : {}),
    };
    const abort = new AbortController();
    req.on('close', (() => abort.abort()) as (arg: never) => void);
    try {
      const r = await fetchFn(`${env.LITELLM_BASE_URL?.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: abort.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LITELLM_API_KEY}` },
        body: JSON.stringify(upstream),
      });
      if (!r.ok || !r.body) return json(res, 502, { error: `The AI service answered ${r.status}: ${(await r.text()).slice(0, 300)}` });
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache, no-transform');
      res.setHeader('x-accel-buffering', 'no'); // a proxy in front must not hold the stream back
      res.flushHeaders?.();
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (e) {
      if (abort.signal.aborted) return res.end();
      if (res.statusCode === 200) return res.end(); // the stream had started: the client sees it end
      return json(res, 502, { error: e instanceof Error ? e.message : 'The AI request failed' });
    }
  };
}
