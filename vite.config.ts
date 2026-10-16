import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { chatMiddleware, type ChatEnv } from './server/chatProxy';
import { llmMiddleware, type LlmEnv } from './server/llmProxy';

export default defineConfig(({ mode }) => {
  // .env.local holds the AI service settings; none of them is exposed to the browser (no VITE_ prefix).
  const env = loadEnv(mode, '.', '') as LlmEnv & ChatEnv;
  return {
    plugins: [
      react(),
      {
        name: 'llm-proxy',
        configureServer(server) {
          server.middlewares.use(llmMiddleware(env) as never);
          server.middlewares.use(chatMiddleware(env) as never);
        },
      },
    ],
    test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
  };
});
