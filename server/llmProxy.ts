// Only what the dev server hands us; avoids pulling Node's type definitions into the browser project.
interface IncomingMessage {
  url?: string;
  method?: string;
  setEncoding(encoding: string): void;
  on(event: 'data' | 'end' | 'error', listener: (arg: never) => void): void;
}
interface ServerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

/** Where the model is reached. Read from .env.local; the key never reaches the browser. */
export interface LlmEnv {
  LITELLM_BASE_URL?: string;
  LITELLM_API_KEY?: string;
  JUDGE_MODEL?: string;
  /** Optional: passed to the model as reasoning_effort (for example "high"). */
  JUDGE_REASONING_EFFORT?: string;
}

export interface LlmRequest {
  system: string;
  user: string;
  /** Page images as data URLs, shown to the model with the user text. */
  images?: string[];
  maxTokens?: number;
}

export const isConfigured = (env: LlmEnv): boolean => Boolean(env.LITELLM_BASE_URL && env.LITELLM_API_KEY && env.JUDGE_MODEL);

/** One chat completion through LiteLLM (OpenAI-compatible). Returns the model's text. */
export async function callLlm(env: LlmEnv, req: LlmRequest, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!isConfigured(env)) throw new Error('The AI service is not configured. Set LITELLM_BASE_URL, LITELLM_API_KEY and JUDGE_MODEL in .env.local and restart the dev server.');
  const url = `${env.LITELLM_BASE_URL?.replace(/\/+$/, '')}/chat/completions`;
  const base = {
    model: env.JUDGE_MODEL,
    temperature: 0,
    max_tokens: req.maxTokens ?? 8000,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.images && req.images.length > 0 ? [{ type: 'text', text: req.user }, ...req.images.map((url) => ({ type: 'image_url', image_url: { url } }))] : req.user },
    ],
  };
  const send = async (body: Record<string, unknown>) =>
    fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LITELLM_API_KEY}` }, body: JSON.stringify(body) });

  const effort = env.JUDGE_REASONING_EFFORT?.trim();
  let res = await send(effort ? { ...base, reasoning_effort: effort } : base);
  // A proxy or model that does not know reasoning_effort: try again without it.
  if (res.status === 400 && effort) res = await send(base);
  if (!res.ok) throw new Error(`The AI service answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : '')).join('');
  throw new Error('The AI service returned no text.');
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', ((c: string) => {
      text += c;
    }) as (arg: never) => void);
    req.on('end', (() => resolve(text)) as (arg: never) => void);
    req.on('error', reject as (arg: never) => void);
  });

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

/** Dev-server middleware: GET /api/llm/status, POST /api/llm. */
export function llmMiddleware(env: LlmEnv, fetchFn: typeof fetch = fetch) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/api/llm/status' && req.method === 'GET') return send(res, 200, { configured: isConfigured(env), model: env.JUDGE_MODEL ?? null });
    if (path !== '/api/llm' || req.method !== 'POST') return next();
    try {
      const body = JSON.parse(await readBody(req)) as Partial<LlmRequest>;
      if (typeof body.system !== 'string' || typeof body.user !== 'string') return send(res, 400, { error: 'system and user text are required' });
      const images = Array.isArray(body.images) ? body.images.filter((x): x is string => typeof x === 'string' && x.startsWith('data:image/')) : undefined;
      const text = await callLlm(env, { system: body.system, user: body.user, images, maxTokens: body.maxTokens }, fetchFn);
      return send(res, 200, { text });
    } catch (e) {
      return send(res, 502, { error: e instanceof Error ? e.message : 'The AI request failed' });
    }
  };
}
