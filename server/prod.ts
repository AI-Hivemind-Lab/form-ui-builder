// The production server: the built app (dist/) plus the AI endpoints, in one process. Run with `npm start` after `npm run build`.
// Settings come from the environment (see .env.example): LITELLM_BASE_URL, LITELLM_API_KEY, JUDGE_MODEL, and for single sign-on AUTH_HEADER.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { authConfigProblem, authEnabled, authMiddleware, USER_HEADER, type AuthEnv } from './auth';
import { chatMiddleware, type ChatEnv } from './chatProxy';
import { llmMiddleware } from './llmProxy';

const raw = process.env as ChatEnv & AuthEnv & { PORT?: string };
// With Google sign-in on, the gate stamps the verified email into USER_HEADER and the AI endpoints read the user from it.
const env: ChatEnv & { PORT?: string } = authEnabled(raw) ? { ...raw, AUTH_HEADER: USER_HEADER } : raw;
const authProblem = authConfigProblem(raw);
if (authProblem) {
  console.error(`Sign-in: ${authProblem}`);
  if ((raw.SESSION_SECRET ?? '').length < 32) process.exit(1); // an unsigned session would be forgeable; a missing allowlist only locks everyone out
}
const gate = authMiddleware(raw);
const root = join(process.cwd(), 'dist');
const port = Number(env.PORT ?? 3000);
const chat = chatMiddleware(env);
const llm = llmMiddleware(env);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json', '.wasm': 'application/wasm',
};

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (file !== root && !file.startsWith(root + sep)) {
    res.statusCode = 403;
    return void res.end('Forbidden');
  }
  const send = async (f: string): Promise<boolean> => {
    try {
      const body = await readFile(f);
      res.statusCode = 200;
      res.setHeader('content-type', TYPES[extname(f)] ?? 'application/octet-stream');
      // built files carry a hash in their name; the page itself must always be fetched again
      res.setHeader('cache-control', f.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.end(body);
      return true;
    } catch {
      return false;
    }
  };
  if (await send(file)) return;
  if (extname(path) === '' && (await send(join(root, 'index.html')))) return; // the app's own address, opened directly
  res.statusCode = 404;
  res.end('Not found');
}

const server = createServer((req, res) => {
  // Google sign-in (when on) answers /login and /api/auth/* itself and lets only signed-in requests through, with the user header stamped.
  void gate(req as never, res as never, () => {
    const api = (req.url ?? '').startsWith('/api/');
    // Behind single sign-on, the AI endpoints need the signed-in user's header. The app must only be reachable through the sign-in proxy,
    // which sets that header itself: a request that skips the proxy could send any value.
    if (api && env.AUTH_HEADER && !String(req.headers[env.AUTH_HEADER.toLowerCase()] ?? '').trim()) {
      res.statusCode = 401;
      res.setHeader('content-type', 'application/json');
      return void res.end(JSON.stringify({ error: 'Sign in first.' }));
    }
    chat(req as never, res as never, () => llm(req as never, res as never, () => void serve(req, res)));
  });
});
server.listen(port, () => console.log(`UI Builder on http://localhost:${port}${env.AUTH_HEADER ? ` (sign-in header: ${env.AUTH_HEADER})` : ''}`));
